/**
 * Wire format for the "not enough free RAM to safely start another profile"
 * error, shared between main (throws it, see profiles/memoryGuard.ts) and
 * renderer (parses it back out of the IPC rejection's message to show a
 * specific, actionable confirm dialog instead of a generic error banner —
 * see ProfilesPage.tsx's runAction). Kept here rather than in
 * memoryGuard.ts because that module imports `node:os`, which has no
 * business being pulled into the renderer bundle.
 */
export const LOW_MEMORY_ERROR_PREFIX = 'LOW_MEMORY:';

export interface LowMemoryDetails {
  freeMemMb: number;
  estimatedCostMb: number;
}

export function formatLowMemoryError(details: LowMemoryDetails): string {
  return `${LOW_MEMORY_ERROR_PREFIX}${details.freeMemMb}:${details.estimatedCostMb}`;
}

/** Returns null for anything that isn't this specific error shape — callers
 * use this to decide whether to show the specific confirm-and-retry flow at
 * all, falling back to the generic error banner otherwise. Deliberately
 * tolerant of Electron's own "Error invoking remote method '...': Error: "
 * wrapper prefix (see errorMessages.ts's own comment on why), by searching
 * for the marker anywhere in the string rather than anchoring to its start. */
export function parseLowMemoryError(message: string): LowMemoryDetails | null {
  const match = new RegExp(`${LOW_MEMORY_ERROR_PREFIX}(\\d+):(\\d+)`).exec(message);
  if (!match) return null;
  return { freeMemMb: Number(match[1]), estimatedCostMb: Number(match[2]) };
}
