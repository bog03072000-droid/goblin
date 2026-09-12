/** JS `Date.getDay()` convention: 0 = Sunday ... 6 = Saturday. */
const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The real local wall-clock "HH:MM" and day-of-week for `now`, in
 * `timeZone` if given, otherwise the caller's own local time (the OS's
 * local time zone in the main process, the renderer's own system time zone
 * in the UI — the same "unspecified means local" convention this app used
 * before per-profile time zones existed). Shared between
 * `src/main/profiles/profileScheduler.ts` (the real trigger check) and
 * `src/shared/utils/scheduleNextRun.ts` (the UI's own "next run" preview)
 * so both compute the exact same answer for the exact same inputs — no
 * separate reimplementation to drift out of sync.
 *
 * Uses `Intl.DateTimeFormat` rather than a date-library dependency —
 * Node's and Chromium's own ICU data already know every real IANA zone's
 * current UTC offset (including DST transitions), which is exactly what's
 * needed here.
 *
 * An invalid/unrecognized zone name throws from the `Intl` constructor
 * itself — left to the caller to catch (see profileScheduler.ts's own
 * "one bad item doesn't halt the batch" fallback).
 *
 * Accepts an optional pre-built `formatter` for callers that need this in
 * a loop (computeNextScheduledRun walks forward minute-by-minute up to a
 * week) — constructing a fresh `Intl.DateTimeFormat` on every one of
 * thousands of iterations would be real, avoidable overhead for a value
 * computed on every render.
 */
export function wallClockIn(now: Date, timeZone: string | null, formatter?: Intl.DateTimeFormat): { hhmm: string; day: number } {
  if (!timeZone) {
    return { hhmm: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`, day: now.getDay() };
  }
  const fmt =
    formatter ??
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    });
  const parts = fmt.formatToParts(now);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  // Some ICU implementations report midnight as "24" with hour12:false —
  // normalize to "00", the same convention ScheduleTimeSchema requires.
  const hour = byType.get('hour') === '24' ? '00' : (byType.get('hour') ?? pad2(now.getHours()));
  const minute = byType.get('minute') ?? pad2(now.getMinutes());
  const weekdayShort = byType.get('weekday') ?? '';
  const day = WEEKDAY_INDEX[weekdayShort] ?? now.getDay();
  return { hhmm: `${hour}:${minute}`, day };
}

/** Builds the reusable formatter `wallClockIn` accepts, for a caller about
 * to call it many times in a loop with the same `timeZone`. */
export function buildWallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit', minute: '2-digit', weekday: 'short' });
}

/**
 * The reverse of `wallClockIn`: given a wall-clock date/time as a plain
 * `"YYYY-MM-DDTHH:MM"` string (exactly what an `<input type="datetime-local">`
 * produces) and the IANA zone that string is meant to be read in, returns
 * the real absolute UTC instant it refers to. Used to convert a one-time
 * schedule's local picker input into the real instant stored in
 * `scheduleOneTimeAt` before it's sent to the server.
 *
 * There's no CDP/Intl method that goes this direction directly (only
 * "instant → wall clock in zone", which `wallClockIn` already uses) — this
 * is the standard single-correction technique for the reverse: treat the
 * input as if it were already UTC (a first guess), see what wall-clock
 * time that guess actually renders as in the target zone, then shift the
 * guess by exactly the difference. A second correction pass would only
 * matter within the same minute as a DST transition in the target zone —
 * a real but vanishingly rare edge case, not worth a second
 * `Intl.DateTimeFormat` call on every save for the general case.
 *
 * `timeZone: null` means "the caller's own local time zone" — handled by
 * `new Date(localDateTimeStr)`, which already parses an offset-less
 * datetime string as local time per the ECMAScript spec, no Intl needed.
 */
export function zonedWallClockToUtc(localDateTimeStr: string, timeZone: string | null): Date {
  if (!timeZone) return new Date(localDateTimeStr);

  const guess = new Date(`${localDateTimeStr}Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const byType = new Map(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const hour = byType.get('hour') === '24' ? '00' : (byType.get('hour') ?? '00');
  const asIfUtc = Date.UTC(
    Number(byType.get('year')),
    Number(byType.get('month')) - 1,
    Number(byType.get('day')),
    Number(hour),
    Number(byType.get('minute')),
    Number(byType.get('second')),
  );
  const offsetMs = guess.getTime() - asIfUtc;
  return new Date(guess.getTime() + offsetMs);
}

/**
 * The forward direction of `zonedWallClockToUtc`: formats a real instant as
 * a `"YYYY-MM-DDTHH:MM"` string in `timeZone` (or the caller's own local
 * time zone if null) — exactly the value an `<input type="datetime-local">`
 * expects, so an existing `scheduleOneTimeAt` can be shown back in the
 * picker in the same zone it was originally entered in.
 */
export function formatInZoneForDateTimeLocal(date: Date, timeZone: string | null): string {
  if (!timeZone) {
    const y = date.getFullYear();
    const mo = pad2(date.getMonth() + 1);
    const d = pad2(date.getDate());
    const h = pad2(date.getHours());
    const mi = pad2(date.getMinutes());
    return `${y}-${mo}-${d}T${h}:${mi}`;
  }
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const byType = new Map(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  const hour = byType.get('hour') === '24' ? '00' : (byType.get('hour') ?? '00');
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}T${hour}:${byType.get('minute')}`;
}
