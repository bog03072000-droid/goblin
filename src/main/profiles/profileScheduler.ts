import type { ProfileRepository } from '../database/profileRepository';
import type { ProfileManager } from './profileManager';
import type { Profile } from '../../shared/schemas/profile';
import { wallClockIn } from '../../shared/utils/wallClockInZone';
import { log } from '../logger';

/** How often the scheduler checks for a due profile. Deliberately shorter
 * than a minute (unlike ProxyHealthScheduler's 5-minute interval) so a
 * scheduled HH:MM is never missed by polling too infrequently — but still
 * coarse enough that two consecutive polls can land in the same matching
 * minute, which is exactly what scheduleLastTriggeredAt guards against
 * below. Overridable for tests only, same PF_* convention as the proxy
 * health scheduler. */
const DEFAULT_INTERVAL_MS = Number(process.env['PF_PROFILE_SCHEDULE_CHECK_INTERVAL_MS'] ?? 30_000);

/**
 * Periodically checks every profile with a schedule turned on (see
 * ProfileRepository.listScheduled()) and starts it automatically:
 * - **recurring** (the original behavior): once the real wall-clock time —
 *   in `scheduleTimezone` if set, otherwise the OS's own local time —
 *   matches `scheduleTime` on one of `scheduleDays`.
 * - **once**: a single absolute instant (`scheduleOneTimeAt`, real UTC ISO)
 *   has passed. Fires at most once — `scheduleEnabled` is turned back off
 *   the moment it fires, on top of the same `scheduleLastTriggeredAt`
 *   dedup guard `recurring` uses, so a profile left open in the editor or a
 *   missed poll can never cause a second start.
 *
 * No cron expressions, no sub-day recurring intervals — this covers the
 * two real, requested gaps (a specific future moment, and per-profile time
 * zones) without inventing scheduling semantics nobody asked for.
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

  private isDue(profile: Profile, now: Date, minuteKey: string): boolean {
    if (profile.scheduleLastTriggeredAt?.slice(0, 16) === minuteKey) return false;
    if (profile.status === 'RUNNING' || profile.status === 'STARTING') return false;

    if (profile.scheduleMode === 'once') {
      if (!profile.scheduleOneTimeAt) return false;
      // Already fired once — scheduleEnabled is turned off in fire() right
      // after, but this guards the same tick's remaining checks too, and
      // any profile whose scheduleEnabled got left on some other way.
      if (profile.scheduleLastTriggeredAt) return false;
      return new Date(profile.scheduleOneTimeAt).getTime() <= now.getTime();
    }

    if (!profile.scheduleTime) return false;
    if (!profile.scheduleDays || profile.scheduleDays.length === 0) return false;
    let wallClock: { hhmm: string; day: number };
    try {
      wallClock = wallClockIn(now, profile.scheduleTimezone);
    } catch (err) {
      log.warn(`[profile:schedule] invalid time zone "${String(profile.scheduleTimezone)}" for "${profile.name}" (${profile.id}), falling back to local time`, err);
      wallClock = wallClockIn(now, null);
    }
    return profile.scheduleTime === wallClock.hhmm && profile.scheduleDays.includes(wallClock.day);
  }

  private fire(profile: Profile, now: Date): void {
    try {
      this.manager.start(profile.id);
      this.profiles.recordScheduleTriggered(profile.id, now.toISOString());
      // A one-time schedule fires exactly once, by definition — turning
      // scheduleEnabled back off is what makes "once" actually mean once
      // rather than "once per minute forever" the instant the trigger-dedup
      // window (this same real-world minute) passes.
      if (profile.scheduleMode === 'once') {
        this.profiles.update(profile.id, { scheduleEnabled: false });
      }
    } catch (err) {
      // One profile's schedule misfiring (e.g. its storage directory went
      // missing) should never stop every other profile's schedule from
      // being checked this tick — same "one bad item doesn't halt the
      // batch" posture as ProxyHealthScheduler and the bulk-operation helpers.
      log.warn(`[profile:schedule] failed to auto-start "${profile.name}" (${profile.id})`, err);
    }
  }

  async runOnce(now: Date = new Date()): Promise<void> {
    // "Which minute is this" as a stable string key — two polls inside the
    // same real-world minute produce the same key, which is exactly the
    // condition scheduleLastTriggeredAt needs to detect to avoid a second,
    // redundant start() call for a profile already (or about to be) running.
    const minuteKey = now.toISOString().slice(0, 16);

    for (const profile of this.profiles.listScheduled()) {
      if (this.isDue(profile, now, minuteKey)) this.fire(profile, now);
    }
  }
}
