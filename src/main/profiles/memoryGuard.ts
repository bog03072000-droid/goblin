import { formatLowMemoryError } from '../../shared/utils/lowMemory';

/**
 * Empirically measured in this project's own real load test
 * (docs/LOAD_TEST.md, "Test 2/3"): each *running* profile costs ~5 real OS
 * processes (main + GPU + renderer + utility + audio) and ~585MB of real
 * RAM — not the ~150-300MB/1-process figure originally assumed when
 * ProfileManager.bulkStart()'s concurrency=4 default was first chosen (that
 * default predates this measurement and was never revisited against it
 * until this stage). Kept as one named, documented constant rather than a
 * magic number so a future re-measurement (different Chromium version,
 * different OS) has one obvious place to update.
 */
export const ESTIMATED_MB_PER_RUNNING_PROFILE = 585;

/**
 * Honest limitation, not fixed: both this constant and SAFE_FREE_RAM_MARGIN_MB
 * below are derived from ONE real measurement on ONE physical machine
 * (docs/LOAD_TEST.md's 31.1GB-RAM test box) — no second machine with a
 * different RAM/CPU/OS configuration was available in this development
 * environment to re-measure against and confirm the constant generalizes.
 * The FORMULA that consumes them (safeAdditionalStartCount(), below) is
 * verified to behave sensibly and monotonically across a wide simulated
 * range of free-RAM totals (tests/unit/memoryGuard.test.ts's sensitivity
 * matrix), so a future re-measurement on different hardware only ever
 * requires updating these two numbers, not the surrounding logic — but the
 * numbers themselves have a sample size of one.
 */

/**
 * Same LOAD_TEST.md finding: the test machine (31.1GB total RAM) was
 * observed to become unreliable once ambient free memory dropped to
 * ~1-2GB, shared with the OS and other running applications. This margin
 * is deliberately set at the higher end of that observed range — a
 * conservative "flag it before things get risky" threshold, not a measured
 * hard crash point.
 */
export const SAFE_FREE_RAM_MARGIN_MB = 1536;

export interface MemoryHeadroom {
  freeMemMb: number;
  estimatedCostMb: number;
  projectedFreeMemMb: number;
  safe: boolean;
}

/**
 * Pure function over an explicit `freeMemBytes` input rather than calling
 * `os.freemem()` itself, so it's unit-testable with no OS mocking — same
 * reasoning `profileWindowArgs.ts`'s `buildWindowArgs()` already follows
 * for keeping Electron/Node-environment reads out of the logic being
 * tested.
 */
export function checkMemoryHeadroom(freeMemBytes: number): MemoryHeadroom {
  const freeMemMb = Math.round(freeMemBytes / (1024 * 1024));
  const projectedFreeMemMb = freeMemMb - ESTIMATED_MB_PER_RUNNING_PROFILE;
  return {
    freeMemMb,
    estimatedCostMb: ESTIMATED_MB_PER_RUNNING_PROFILE,
    projectedFreeMemMb,
    safe: projectedFreeMemMb >= SAFE_FREE_RAM_MARGIN_MB,
  };
}

/**
 * How many more profiles bulkStart's chunked launcher can safely fire off
 * in its next chunk, given the machine's current free memory — replaces a
 * fixed `concurrency` with one that actually reflects the headroom
 * LOAD_TEST.md measured, instead of the same count regardless of whether
 * 2GB or 20GB is free. Always returns at least 1 rather than 0: a queue
 * that could stall forever waiting for headroom a memory-constrained
 * machine will never have is worse than launching one at a time and
 * letting the existing per-profile try/catch in bulkRun() surface any
 * resulting failure, same tradeoff already made there for other error
 * classes.
 */
export function safeAdditionalStartCount(freeMemBytes: number, maxConcurrency: number): number {
  const freeMemMb = Math.round(freeMemBytes / (1024 * 1024));
  const spendableMb = freeMemMb - SAFE_FREE_RAM_MARGIN_MB;
  const roomFor = Math.floor(spendableMb / ESTIMATED_MB_PER_RUNNING_PROFILE);
  return Math.max(1, Math.min(maxConcurrency, roomFor));
}

/**
 * Thrown by ProfileManager.start() when headroom is insufficient and the
 * caller hasn't already acknowledged the risk (see its `acknowledgeLowMemory`
 * option). Its `.message` is a machine-parseable wire format (see
 * shared/utils/lowMemory.ts) so the renderer can show a specific "N MB
 * free, start anyway?" confirm dialog instead of a generic error banner —
 * this is a soft limit the user can override, not a hard block, per the
 * request that led to this: warn before a crash, don't just prevent one
 * choice the user might have good reason to make anyway (e.g. they closed
 * other applications right before clicking Start).
 */
export class LowMemoryError extends Error {
  constructor(public readonly headroom: MemoryHeadroom) {
    super(formatLowMemoryError({ freeMemMb: headroom.freeMemMb, estimatedCostMb: headroom.estimatedCostMb }));
    this.name = 'LowMemoryError';
  }
}
