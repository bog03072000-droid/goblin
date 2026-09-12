import { describe, it, expect } from 'vitest';
import { computeNextScheduledRun } from '../../src/shared/utils/scheduleNextRun';

describe('computeNextScheduledRun', () => {
  it('returns null when scheduleTime is null', () => {
    expect(computeNextScheduledRun(new Date('2026-09-07T10:00:00'), null, [1])).toBeNull();
  });

  it('returns null when scheduleDays is null or empty', () => {
    expect(computeNextScheduledRun(new Date('2026-09-07T10:00:00'), '09:00', null)).toBeNull();
    expect(computeNextScheduledRun(new Date('2026-09-07T10:00:00'), '09:00', [])).toBeNull();
  });

  it('returns null for a malformed scheduleTime', () => {
    expect(computeNextScheduledRun(new Date('2026-09-07T10:00:00'), '9am', [1])).toBeNull();
  });

  it('picks later today when the scheduled time has not passed yet and today is a scheduled day', () => {
    // 2026-09-07 is a Monday (day 1).
    const now = new Date('2026-09-07T08:00:00');
    const next = computeNextScheduledRun(now, '09:00', [1]);
    expect(next).toEqual(new Date('2026-09-07T09:00:00'));
  });

  it('rolls to the next scheduled day when today\'s time has already passed', () => {
    const now = new Date('2026-09-07T10:00:00'); // Monday, after 09:00
    const next = computeNextScheduledRun(now, '09:00', [1]); // only Mondays
    expect(next).toEqual(new Date('2026-09-14T09:00:00'));
  });

  it('rolls to the next scheduled day when today is not among scheduleDays at all', () => {
    const now = new Date('2026-09-07T08:00:00'); // Monday
    const next = computeNextScheduledRun(now, '09:00', [3]); // Wednesday only
    expect(next).toEqual(new Date('2026-09-09T09:00:00'));
  });

  it('picks the nearest of several scheduled days', () => {
    const now = new Date('2026-09-07T10:00:00'); // Monday, past 09:00
    const next = computeNextScheduledRun(now, '09:00', [1, 3, 5]); // Mon/Wed/Fri
    expect(next).toEqual(new Date('2026-09-09T09:00:00')); // Wednesday
  });

  it('treats exactly-now as already passed, not a match for today', () => {
    const now = new Date('2026-09-07T09:00:00');
    const next = computeNextScheduledRun(now, '09:00', [1]);
    expect(next).toEqual(new Date('2026-09-14T09:00:00'));
  });
});

describe('computeNextScheduledRun with a per-profile time zone', () => {
  it('computes the next run in the given IANA zone, not the local machine time zone — verified against a real UTC instant', () => {
    // 2026-09-07T00:00:00Z is exactly 09:00 on Monday in Asia/Tokyo (UTC+9,
    // no DST) — deliberately chosen so the assertion doesn't depend on
    // whatever time zone the test runner's own machine happens to be in.
    const now = new Date('2026-09-07T00:00:00Z');
    // Exactly-now (09:00 Monday Tokyo) counts as already passed, same rule
    // as the local-time path — rolls to the following Monday.
    const next = computeNextScheduledRun(now, '09:00', [1], 'Asia/Tokyo');
    expect(next).toEqual(new Date('2026-09-14T00:00:00Z'));
  });

  it('picks a later time the same day, in the target zone', () => {
    const now = new Date('2026-09-07T00:00:00Z'); // 09:00 Monday in Tokyo
    const next = computeNextScheduledRun(now, '10:00', [1], 'Asia/Tokyo');
    // 10:00 Tokyo the same day = 01:00 UTC.
    expect(next).toEqual(new Date('2026-09-07T01:00:00Z'));
  });

  it('two different zones for the identical wall-clock schedule produce different real instants', () => {
    const now = new Date('2026-09-07T00:00:00Z');
    const tokyo = computeNextScheduledRun(now, '12:00', [1], 'Asia/Tokyo');
    const newYork = computeNextScheduledRun(now, '12:00', [1], 'America/New_York');
    expect(tokyo).not.toEqual(newYork);
  });

  it('falls back to local-time behavior for an invalid/unrecognized zone name, rather than throwing or returning null', () => {
    const now = new Date('2026-09-07T08:00:00'); // Monday, local
    const withBadZone = computeNextScheduledRun(now, '09:00', [1], 'Not/AZone');
    const localOnly = computeNextScheduledRun(now, '09:00', [1], null);
    expect(withBadZone).toEqual(localOnly);
  });

  it('omitting the time zone argument entirely still uses local time (backward compatible with every pre-existing call site)', () => {
    const now = new Date('2026-09-07T08:00:00');
    expect(computeNextScheduledRun(now, '09:00', [1])).toEqual(new Date('2026-09-07T09:00:00'));
  });
});
