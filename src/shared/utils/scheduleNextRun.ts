/**
 * Pure "when does this schedule next fire" calculation, shared by the
 * renderer (ProfilesTable.tsx's next-run badge) and testable in isolation
 * from ProfileScheduler's own polling loop (src/main/profiles/profileScheduler.ts),
 * which this deliberately mirrors: local wall-clock time/day, no cron
 * expressions, no per-profile time zone — see that file's own doc comment
 * for why. Returns null when there is nothing to compute (schedule off, no
 * time set, or no days selected), matching ProfileScheduler's own
 * conditions for a schedule that can never fire.
 */
export function computeNextScheduledRun(now: Date, scheduleTime: string | null, scheduleDays: number[] | null): Date | null {
  if (!scheduleTime || !scheduleDays || scheduleDays.length === 0) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(scheduleTime);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  // Walk forward day by day (today first) up to a week out — today only
  // counts if the scheduled time hasn't already passed, otherwise the next
  // occurrence rolls to the following matching day.
  for (let offset = 0; offset <= 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(candidate.getDate() + offset);
    candidate.setHours(hours, minutes, 0, 0);
    if (offset === 0 && candidate.getTime() <= now.getTime()) continue;
    if (scheduleDays.includes(candidate.getDay())) return candidate;
  }
  return null;
}
