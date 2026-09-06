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
