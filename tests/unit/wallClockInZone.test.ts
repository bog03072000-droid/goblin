import { describe, it, expect } from 'vitest';
import { wallClockIn, buildWallClockFormatter, zonedWallClockToUtc, formatInZoneForDateTimeLocal } from '../../src/shared/utils/wallClockInZone';

describe('wallClockIn', () => {
  it('with no time zone, returns the real local wall-clock time/day', () => {
    const now = new Date(2026, 8, 2, 14, 37, 0); // local: Wednesday 14:37
    expect(wallClockIn(now, null)).toEqual({ hhmm: '14:37', day: 3 });
  });

  it('with a time zone, returns the wall-clock time/day in that zone, verified against a real UTC instant', () => {
    // 2026-09-02T00:00:00Z is exactly 09:00 Wednesday in Asia/Tokyo (UTC+9, no DST).
    const instant = new Date('2026-09-02T00:00:00Z');
    expect(wallClockIn(instant, 'Asia/Tokyo')).toEqual({ hhmm: '09:00', day: 3 });
  });

  it('accepts a pre-built formatter and produces the identical result', () => {
    const instant = new Date('2026-09-02T00:00:00Z');
    const fmt = buildWallClockFormatter('Asia/Tokyo');
    expect(wallClockIn(instant, 'Asia/Tokyo', fmt)).toEqual(wallClockIn(instant, 'Asia/Tokyo'));
  });

  it('throws for an invalid/unrecognized zone name (the caller is responsible for catching this)', () => {
    expect(() => wallClockIn(new Date(), 'Not/AZone')).toThrow();
  });

  it('two zones with different UTC offsets report different wall-clock times for the same instant', () => {
    const instant = new Date('2026-09-02T12:00:00Z');
    const tokyo = wallClockIn(instant, 'Asia/Tokyo');
    const newYork = wallClockIn(instant, 'America/New_York');
    expect(tokyo.hhmm).not.toBe(newYork.hhmm);
  });
});

describe('zonedWallClockToUtc / formatInZoneForDateTimeLocal round-trip', () => {
  it('with no time zone, parses the string as local time (same as `new Date(str)`)', () => {
    const result = zonedWallClockToUtc('2026-12-25T08:00', null);
    expect(result).toEqual(new Date('2026-12-25T08:00'));
  });

  it('converts a wall-clock time in Asia/Tokyo to the correct real UTC instant', () => {
    // 09:00 on 2026-09-02 in Tokyo (UTC+9) is 00:00 UTC the same day.
    const result = zonedWallClockToUtc('2026-09-02T09:00', 'Asia/Tokyo');
    expect(result.toISOString()).toBe('2026-09-02T00:00:00.000Z');
  });

  it('converting then formatting back in the same zone round-trips to the original wall-clock string', () => {
    const original = '2026-09-02T09:00';
    const utc = zonedWallClockToUtc(original, 'Asia/Tokyo');
    const back = formatInZoneForDateTimeLocal(utc, 'Asia/Tokyo');
    expect(back).toBe(original);
  });

  it('the same wall-clock string in two different zones produces two different real instants', () => {
    const tokyo = zonedWallClockToUtc('2026-09-02T09:00', 'Asia/Tokyo');
    const newYork = zonedWallClockToUtc('2026-09-02T09:00', 'America/New_York');
    expect(tokyo.getTime()).not.toBe(newYork.getTime());
  });

  it('formatInZoneForDateTimeLocal with no time zone formats in real local time', () => {
    const date = new Date(2026, 11, 25, 8, 0, 0); // local Dec 25 2026, 08:00
    expect(formatInZoneForDateTimeLocal(date, null)).toBe('2026-12-25T08:00');
  });
});
