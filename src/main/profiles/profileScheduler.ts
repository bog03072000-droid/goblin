import type { ProfileRepository } from '../database/profileRepository';
import type { ProfileManager } from './profileManager';
import { log } from '../logger';

/** How often the scheduler checks for a due profile. Deliberately shorter
 * than a minute (unlike ProxyHealthScheduler's 5-minute interval) so a
 * scheduled HH:MM is never missed by polling too infrequently — but still
 * coarse enough that two consecutive polls can land in the same matching
 * minute, which is exactly what scheduleLastTriggeredAt guards against
 * below. Overridable for tests only, same PF_* convention as the proxy
 * health scheduler. */
const DEFAULT_INTERVAL_MS = Number(process.env['PF_PROFILE_SCHEDULE_CHECK_INTERVAL_MS'] ?? 30_000);

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Periodically checks every profile with a recurring schedule turned on
 * (see ProfilesRepository.listScheduled()) and starts it automatically once
 * the real local wall-clock time/day matches — the "keep this profile warm
 * every day at 9am" use case an antidetect browser's daily-use workflow
 * actually needs, previously entirely manual.
 *
 * Deliberately simple: no cron expressions, no per-profile time zone (uses
 * the OS's local time, same as everything else in this app that isn't the
 * fingerprint's own claimed time zone — an independent, unrelated concern,
 * see docs/FINGERPRINT_AUDIT.md), no one-time/non-recurring schedules. This
 * covers the actual requested gap without inventing scheduling semantics
 * nobody asked for.
 */
export class ProfileScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly profiles: ProfileRepository,
    private readonly manager: ProfileManager,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    const currentTime = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    const currentDay = now.getDay();
    // "Which minute is this" as a stable string key — two polls inside the
    // same real-world minute produce the same key, which is exactly the
    // condition scheduleLastTriggeredAt needs to detect to avoid a second,
    // redundant start() call for a profile already (or about to be) running.
    const minuteKey = now.toISOString().slice(0, 16);

    for (const profile of this.profiles.listScheduled()) {
      if (profile.scheduleTime !== currentTime) continue;
      if (!profile.scheduleDays || !profile.scheduleDays.includes(currentDay)) continue;
      if (profile.scheduleLastTriggeredAt?.slice(0, 16) === minuteKey) continue;
      if (profile.status === 'RUNNING' || profile.status === 'STARTING') continue;

      try {
        this.manager.start(profile.id);
        this.profiles.recordScheduleTriggered(profile.id, now.toISOString());
      } catch (err) {
        // One profile's schedule misfiring (e.g. its storage directory went
        // missing) should never stop every other profile's schedule from
        // being checked this tick — same "one bad item doesn't halt the
        // batch" posture as ProxyHealthScheduler and the bulk-operation helpers.
        log.warn(`[profile:schedule] failed to auto-start "${profile.name}" (${profile.id})`, err);
      }
    }
  }
}
