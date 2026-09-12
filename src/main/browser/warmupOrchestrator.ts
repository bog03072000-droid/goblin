import type { WebContents } from 'electron';
import { humanScroll, type CdpSession } from '../../shared/automation/humanInputDriver';

/** Mirrors Dolphin Anty's "Cookie Robot" concept: visit a list of real
 * URLs, one at a time, scrolling like a real person on each, to build
 * organic browsing history/cookies before a profile's actual use — a
 * documented gap versus that competitor (see the GoblinAnty-vs-Octo/Dolphin
 * research this feature came out of). Built entirely on top of the
 * already-existing `humanScroll` primitive
 * (`src/shared/automation/humanInputDriver.ts`) and the same
 * `webContents.debugger`/CDP session pattern the "Test human input" button
 * already uses (`pf:test-human-input` in profileWindowEntry.ts) — no new
 * automation mechanism, just a sequencer on top of the existing one. */

export type WarmupStatus = 'loading' | 'browsing' | 'done' | 'error' | 'skipped-invalid-url';

export interface WarmupProgressEvent {
  index: number;
  total: number;
  url: string;
  status: WarmupStatus;
  error?: string;
}

/** Only http(s) — this drives a real `webContents.loadURL()` against
 * whatever a caller supplies, so anything else (`file:`, `javascript:`,
 * a custom scheme) is rejected up front rather than silently attempted. */
function isWarmableUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * `webContents.loadURL()` already returns a promise that resolves once the
 * page has actually finished loading (or rejects on a real load failure) —
 * confirmed against this exact object via the existing 'did-start-navigation'
 * listener already attached to it elsewhere in profileWindowEntry.ts. An
 * earlier version of this function separately awaited a
 * 'did-finish-load'/'did-fail-load' listener *after* `loadURL()` resolved —
 * which is exactly one event too late: by the time that `await` returns,
 * 'did-finish-load' has already fired, so the extra listener was waiting
 * for an event that could never come again, silently eating this
 * function's entire fallback timeout on every single page (confirmed live
 * via tests/e2e/warmupProfile.spec.ts, which consistently took ~20s per
 * page — exactly this function's old default timeout — until this was
 * fixed). `loadURL()` itself is the only wait needed; this just adds a
 * bounded timeout race on top so one hung/never-resolving load can't wedge
 * the whole warm-up run — same "one bad item doesn't stop the batch"
 * posture as the rest of this app's schedulers/bulk operations.
 */
export function loadWithTimeout(webContents: WebContents, url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Page load timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    webContents.loadURL(url).then(
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      },
      (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export interface RunWarmupOptions {
  /** Real per-page load timeout — kept short relative to the overall
   * duration so one hung page can't eat the whole budget. */
  pageLoadTimeoutMs?: number;
  /** Floor under which a per-site time slice is never rounded down to,
   * even when the requested duration split across many URLs would
   * otherwise give each one only a few milliseconds — real reading/
   * scrolling needs at least this long to look like a real visit rather
   * than a mechanical flicker. Configurable (not a bare constant) so
   * tests can shrink it — the real UI-facing default (2000ms) would make
   * a fast unit test artificially spend real wall-clock seconds per case. */
  minSiteBudgetMs?: number;
}

/**
 * Visits `urls` in order against the real, already-running `webContents`
 * (the active tab's webview, same object `pf:navigate`/`pf:test-human-input`
 * already operate on), scrolling each with `humanScroll` over the CDP
 * `session` already attached for fingerprint/human-input purposes. Stops
 * once `durationSeconds` has elapsed (checked between pages, not
 * preemptively mid-scroll) or the URL list is exhausted, whichever comes
 * first — never runs longer than requested, may finish earlier if the URL
 * list is short. An invalid (non-http/https) URL is reported and skipped,
 * not thrown — same "one bad item doesn't stop the batch" reasoning as the
 * page-load-timeout case above.
 */
export async function runWarmup(
  webContents: WebContents,
  session: CdpSession,
  urls: string[],
  durationSeconds: number,
  onProgress?: (event: WarmupProgressEvent) => void,
  options: RunWarmupOptions = {},
): Promise<{ visited: number; skipped: number }> {
  const pageLoadTimeoutMs = options.pageLoadTimeoutMs ?? 20_000;
  const minSiteBudgetMs = options.minSiteBudgetMs ?? 2000;
  const deadline = Date.now() + durationSeconds * 1000;
  const perSiteBudgetMs = urls.length > 0 ? Math.max(minSiteBudgetMs, (durationSeconds * 1000) / urls.length) : 0;
  let visited = 0;
  let skipped = 0;

  for (let i = 0; i < urls.length; i++) {
    if (Date.now() >= deadline) break;
    const url = urls[i]!;

    if (!isWarmableUrl(url)) {
      skipped++;
      onProgress?.({ index: i, total: urls.length, url, status: 'skipped-invalid-url' });
      continue;
    }

    onProgress?.({ index: i, total: urls.length, url, status: 'loading' });
    try {
      await loadWithTimeout(webContents, url, pageLoadTimeoutMs);
    } catch (err) {
      onProgress?.({ index: i, total: urls.length, url, status: 'error', error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    onProgress?.({ index: i, total: urls.length, url, status: 'browsing' });
    const siteStart = Date.now();
    try {
      const viewport = (await webContents.executeJavaScript('({ w: window.innerWidth, h: window.innerHeight })')) as {
        w: number;
        h: number;
      };
      const at = { x: Math.round(viewport.w / 2), y: Math.round(viewport.h / 2) };
      // Scrolls somewhere between one and three viewport-heights down —
      // enough to look like real reading, not a full-page mechanical
      // sweep every time.
      const scrollTarget = Math.round(viewport.h * (1 + Math.random() * 2));
      await humanScroll(session, at, scrollTarget, { pauseProbability: 0.3 });
    } catch (err) {
      // A page whose content script access throws (rare, but real — e.g.
      // a page that navigates itself away mid-scroll) shouldn't abort the
      // whole run either.
      onProgress?.({ index: i, total: urls.length, url, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }

    const remainingBudgetMs = Math.min(perSiteBudgetMs, Math.max(0, deadline - Date.now()));
    const alreadySpentMs = Date.now() - siteStart;
    await sleep(Math.max(0, remainingBudgetMs - alreadySpentMs));

    visited++;
    onProgress?.({ index: i, total: urls.length, url, status: 'done' });
  }

  return { visited, skipped };
}
