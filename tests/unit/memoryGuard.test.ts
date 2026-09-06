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

/**
 * Sensitivity matrix requested explicitly because ESTIMATED_MB_PER_RUNNING_PROFILE
 * and SAFE_FREE_RAM_MARGIN_MB are both derived from a single real measurement
 * on one machine (docs/LOAD_TEST.md) — no second physical machine with a
 * different RAM configuration was available in this environment to
 * re-measure against, so this cannot become a genuine hardware-diversity
 * test. What it CAN honestly verify: that the formula itself behaves
 * sensibly and monotonically across the realistic range of total-free-RAM a
 * real user's machine might report, not just the handful of boundary points
 * the tests above already cover for the current constant's exact value.
 * If a future re-measurement on different hardware changes either
 * constant, this matrix still documents the expected shape of the
 * response curve to sanity-check against.
 */
describe('safeAdditionalStartCount — sensitivity across realistic machine RAM totals', () => {
  const GB = 1024 * MB;
  // Free RAM at the moment of a bulk-start click, not total installed RAM —
  // already assumes the OS/other apps have claimed some share, same as any
  // real os.freemem() reading would.
  const scenarios: Array<{ label: string; freeMemBytes: number }> = [
    { label: 'low-end machine, 2GB free', freeMemBytes: 2 * GB },
    { label: 'typical machine, 4GB free', freeMemBytes: 4 * GB },
    { label: 'typical machine, 8GB free', freeMemBytes: 8 * GB },
    { label: 'well-provisioned machine, 16GB free', freeMemBytes: 16 * GB },
    { label: 'workstation, 32GB free', freeMemBytes: 32 * GB },
    { label: 'high-end workstation, 64GB free', freeMemBytes: 64 * GB },
  ];

  it.each(scenarios)('$label: never recommends a concurrency that would itself violate the safety margin', ({ freeMemBytes }) => {
    const recommended = safeAdditionalStartCount(freeMemBytes, 100); // no artificial concurrency cap
    const projectedAfter = freeMemBytes / MB - recommended * ESTIMATED_MB_PER_RUNNING_PROFILE;
    expect(projectedAfter).toBeGreaterThanOrEqual(SAFE_FREE_RAM_MARGIN_MB - ESTIMATED_MB_PER_RUNNING_PROFILE);
  });

  it('recommended concurrency is monotonically non-decreasing as free RAM increases', () => {
    const recommendations = scenarios.map((s) => safeAdditionalStartCount(s.freeMemBytes, 100));
    for (let i = 1; i < recommendations.length; i++) {
      expect(recommendations[i]!).toBeGreaterThanOrEqual(recommendations[i - 1]!);
    }
  });

  it('a low-end 2GB-free machine is still recommended at least 1 (never fully stalls the queue)', () => {
    expect(safeAdditionalStartCount(2 * GB, 4)).toBeGreaterThanOrEqual(1);
  });

  it('a high-end 64GB-free machine is capped at the requested concurrency, not left unbounded', () => {
    expect(safeAdditionalStartCount(64 * GB, 4)).toBe(4);
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
