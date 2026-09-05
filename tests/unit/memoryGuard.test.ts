import { describe, it, expect } from 'vitest';
import {
  checkMemoryHeadroom,
  safeAdditionalStartCount,
  LowMemoryError,
  ESTIMATED_MB_PER_RUNNING_PROFILE,
  SAFE_FREE_RAM_MARGIN_MB,
} from '../../src/main/profiles/memoryGuard';
import { formatLowMemoryError, parseLowMemoryError } from '../../src/shared/utils/lowMemory';

const MB = 1024 * 1024;

describe('checkMemoryHeadroom', () => {
  it('is safe when plenty of RAM is free (well above the estimated cost plus margin)', () => {
    const result = checkMemoryHeadroom(20_000 * MB);
    expect(result.safe).toBe(true);
    expect(result.freeMemMb).toBe(20_000);
    expect(result.estimatedCostMb).toBe(ESTIMATED_MB_PER_RUNNING_PROFILE);
  });

  it('is unsafe when free RAM minus the estimated cost would fall below the safety margin', () => {
    const result = checkMemoryHeadroom((SAFE_FREE_RAM_MARGIN_MB + ESTIMATED_MB_PER_RUNNING_PROFILE - 1) * MB);
    expect(result.safe).toBe(false);
  });

  it('is exactly at the boundary (safe) when projected free memory equals the margin precisely', () => {
    const result = checkMemoryHeadroom((SAFE_FREE_RAM_MARGIN_MB + ESTIMATED_MB_PER_RUNNING_PROFILE) * MB);
    expect(result.safe).toBe(true);
    expect(result.projectedFreeMemMb).toBe(SAFE_FREE_RAM_MARGIN_MB);
  });

  it('is unsafe when there is barely any free memory at all', () => {
    const result = checkMemoryHeadroom(100 * MB);
    expect(result.safe).toBe(false);
    expect(result.projectedFreeMemMb).toBeLessThan(0);
  });
});

describe('safeAdditionalStartCount', () => {
  it('caps at maxConcurrency when there is abundant free memory', () => {
    expect(safeAdditionalStartCount(50_000 * MB, 4)).toBe(4);
  });

  it('never returns less than 1, even with almost no free memory', () => {
    expect(safeAdditionalStartCount(10 * MB, 4)).toBe(1);
  });

  it('throttles below maxConcurrency when memory only supports fewer', () => {
    // Room for exactly 2 more profiles' worth of spendable memory.
    const freeMemBytes = (SAFE_FREE_RAM_MARGIN_MB + ESTIMATED_MB_PER_RUNNING_PROFILE * 2) * MB;
    expect(safeAdditionalStartCount(freeMemBytes, 4)).toBe(2);
  });

  it('never exceeds the requested maxConcurrency even with unlimited memory', () => {
    expect(safeAdditionalStartCount(1_000_000 * MB, 3)).toBe(3);
  });
});

describe('LowMemoryError', () => {
  it('carries the headroom details and formats a parseable message', () => {
    const headroom = checkMemoryHeadroom(500 * MB);
    const err = new LowMemoryError(headroom);
    expect(err.name).toBe('LowMemoryError');
    expect(err.headroom).toBe(headroom);
    expect(parseLowMemoryError(err.message)).toEqual({
      freeMemMb: headroom.freeMemMb,
      estimatedCostMb: headroom.estimatedCostMb,
    });
  });
});

describe('formatLowMemoryError / parseLowMemoryError round-trip', () => {
  it('round-trips through Electron\'s "Error invoking remote method" IPC-rejection wrapper prefix', () => {
    const wrapped = `Error invoking remote method 'profiles:start': Error: ${formatLowMemoryError({ freeMemMb: 512, estimatedCostMb: 585 })}`;
    expect(parseLowMemoryError(wrapped)).toEqual({ freeMemMb: 512, estimatedCostMb: 585 });
  });

  it('returns null for a message that is not this specific error shape', () => {
    expect(parseLowMemoryError('Profile is already running')).toBeNull();
  });
});
