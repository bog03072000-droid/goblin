import { wallClockIn, buildWallClockFormatter } from './wallClockInZone';

/**
 * Pure "when does this schedule next fire" calculation, shared by the
 * renderer (ProfilesTable.tsx's next-run badge) and testable in isolation
 * from ProfileScheduler's own polling loop (src/main/profiles/profileScheduler.ts),
 * which this deliberately mirrors. Returns null when there is nothing to
 * compute (schedule off, no time set, or no days selected), matching
 * ProfileScheduler's own conditions for a schedule that can never fire.
 *
 * `timeZone` omitted or null means the caller's own local wall-clock time
 * (the original, unchanged behavior — every profile predating per-profile
 * time zones keeps computing exactly the same preview it always did). When
 * given, walks forward minute-by-minute (bounded to a week) checking the
 * real wall-clock time in that zone via `wallClockIn` — the same function
 * ProfileScheduler's real trigger check uses — rather than reimplementing
 * IANA offset/DST math with plain `Date` arithmetic, which is exactly the
 * kind of subtly-wrong-around-a-DST-transition bug a bespoke calculation
 * would risk. A week of minutes (10080) is a bounded, cheap loop — this
 * runs once per render on user input, not in the real scheduler's own hot
 * path (that one only calls wallClockIn once per tick, no loop needed).
 */
export function computeNextScheduledRun(
  now: Date,
  scheduleTime: string | null,
  scheduleDays: number[] | null,
  timeZone?: string | null,
): Date | null {
  if (!scheduleTime || !scheduleDays || scheduleDays.length === 0) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(scheduleTime);
  if (!match) return null;

  if (!timeZone) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    // Walk forward day by day (today first) up to a week out — today only
    // counts if the scheduled time hasn't already passed, otherwise the
    // next occurrence rolls to the following matching day.
    for (let offset = 0; offset <= 7; offset++) {
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hours, minutes, 0, 0);
      if (offset === 0 && candidate.getTime() <= now.getTime()) continue;
      if (scheduleDays.includes(candidate.getDay())) return candidate;
    }
    return null;
  }

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = buildWallClockFormatter(timeZone);
  } catch {
    // An invalid/unrecognized zone name — same fallback ProfileScheduler
    // itself uses (local time) rather than showing no preview at all.
    return computeNextScheduledRun(now, scheduleTime, scheduleDays, null);
  }
  const candidate = new Date(now.getTime());
  candidate.setSeconds(0, 0);
  for (let i = 0; i <= 7 * 24 * 60; i++) {
    if (i > 0) candidate.setTime(candidate.getTime() + 60_000);
    if (candidate.getTime() <= now.getTime()) continue;
    const wallClock = wallClockIn(candidate, timeZone, formatter);
    if (wallClock.hhmm === scheduleTime && scheduleDays.includes(wallClock.day)) return new Date(candidate.getTime());
  }
  return null;
}
