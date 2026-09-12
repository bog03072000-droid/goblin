import { describe, it, expect, vi } from 'vitest';
import { runWarmup, type WarmupProgressEvent } from '../../src/main/browser/warmupOrchestrator';
import type { CdpSession } from '../../src/shared/automation/humanInputDriver';

/** A minimal fake WebContents. `loadURL` resolves immediately by default —
 * matching real Electron behavior confirmed live: `webContents.loadURL()`
 * itself already resolves once the page has finished loading (it does not
 * need a separate 'did-finish-load' listener afterward, which is exactly
 * the bug an earlier version of `runWarmup` had — see that file's own
 * comment on `loadWithTimeout`). `executeJavaScript` returns a fixed
 * viewport. */
function makeFakeWebContents(overrides: { loadURLImpl?: (url: string) => Promise<void> } = {}) {
  const loadURL = vi.fn(async (url: string) => {
    if (overrides.loadURLImpl) return overrides.loadURLImpl(url);
  });
  // A tiny viewport, not a real 1280x800 — buildHumanScrollPlan's pacing
  // scales with scroll distance (viewport height here), so a small one
  // keeps every test's real wall-clock scroll time under ~200ms instead of
  // the ~1s a full-size viewport would cost per visited site.
  const executeJavaScript = vi.fn(async () => ({ w: 128, h: 40 }));
  return { loadURL, executeJavaScript } as unknown as import('electron').WebContents & {
    loadURL: typeof loadURL;
    executeJavaScript: typeof executeJavaScript;
  };
}

function makeFakeSession(): CdpSession & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn(async () => ({})) };
}

describe('runWarmup', () => {
  it('visits every URL in order and reports done for each, when there is ample time budget', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    const events: WarmupProgressEvent[] = [];

    const result = await runWarmup(wc, session, ['https://a.example', 'https://b.example'], 1, (e) => events.push(e), {
      minSiteBudgetMs: 0,
    });

    expect(result).toEqual({ visited: 2, skipped: 0 });
    expect(wc.loadURL).toHaveBeenNthCalledWith(1, 'https://a.example');
    expect(wc.loadURL).toHaveBeenNthCalledWith(2, 'https://b.example');
    const statuses = events.filter((e) => e.url === 'https://a.example').map((e) => e.status);
    expect(statuses).toEqual(['loading', 'browsing', 'done']);
  });

  it('actually scrolls each visited page via the real humanScroll CDP mechanism (Input.dispatchMouseEvent mouseWheel)', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();

    await runWarmup(wc, session, ['https://a.example'], 0.5, undefined, { minSiteBudgetMs: 0 });

    const wheelCalls = session.send.mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent');
    expect(wheelCalls.length).toBeGreaterThan(0);
    expect(wheelCalls.every(([, params]) => (params as { type: string }).type === 'mouseWheel')).toBe(true);
  });

  it('stops once the duration budget is exhausted, even with URLs left unvisited', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    const events: WarmupProgressEvent[] = [];

    // A short 0.5 real-second total budget split across 5 URLs, each
    // floored to a 200ms minimum slice — enough real per-site pacing to
    // prove the deadline check actually cuts the run short, without
    // costing a real 60 minutes-style budget's worth of wall-clock time in
    // a unit test. The assertion is "not all five ran" (proving the
    // deadline check works at all), not an exact count, which would make
    // this test flaky against real wall-clock timing.
    const result = await runWarmup(
      wc,
      session,
      ['https://a.example', 'https://b.example', 'https://c.example', 'https://d.example', 'https://e.example'],
      0.5,
      (e) => events.push(e),
      { minSiteBudgetMs: 200 },
    );

    expect(result.visited).toBeLessThan(5);
    expect(result.visited).toBeGreaterThan(0);
  });

  it('skips a non-http(s) URL without stopping the rest of the run, reporting skipped-invalid-url', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();
    const events: WarmupProgressEvent[] = [];

    const result = await runWarmup(wc, session, ['javascript:alert(1)', 'https://real.example'], 1, (e) => events.push(e), {
      minSiteBudgetMs: 0,
    });

    expect(result).toEqual({ visited: 1, skipped: 1 });
    expect(wc.loadURL).toHaveBeenCalledTimes(1);
    expect(wc.loadURL).toHaveBeenCalledWith('https://real.example');
    expect(events.find((e) => e.url === 'javascript:alert(1)')?.status).toBe('skipped-invalid-url');
  });

  it('skips a file:// URL the same way (never navigates the real webview to a local file)', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();

    const result = await runWarmup(wc, session, ['file:///etc/passwd'], 60);

    expect(result).toEqual({ visited: 0, skipped: 1 });
    expect(wc.loadURL).not.toHaveBeenCalled();
  });

  it('a page whose loadURL rejects is reported as an error and does not stop the rest of the run', async () => {
    const wc = makeFakeWebContents({
      loadURLImpl: async (url: string) => {
        if (url === 'https://broken.example') throw new Error('net::ERR_NAME_NOT_RESOLVED');
      },
    });
    const session = makeFakeSession();
    const events: WarmupProgressEvent[] = [];

    const result = await runWarmup(wc, session, ['https://broken.example', 'https://ok.example'], 1, (e) => events.push(e), {
      minSiteBudgetMs: 0,
    });

    expect(result.visited).toBe(1);
    const brokenEvent = events.find((e) => e.url === 'https://broken.example' && e.status === 'error');
    expect(brokenEvent?.error).toContain('ERR_NAME_NOT_RESOLVED');
    expect(wc.loadURL).toHaveBeenCalledWith('https://ok.example');
  });

  it('a loadURL() call that never resolves times out instead of hanging the whole run forever', async () => {
    // A real, literal hang — the promise `webContents.loadURL()` itself
    // returns never settles (e.g. a request that never completes at the
    // network layer). loadWithTimeout's own race is what has to save this,
    // since there's no separate event to fall back to.
    const wc = makeFakeWebContents({
      loadURLImpl: (url: string) => (url === 'https://hangs.example' ? new Promise<void>(() => {}) : Promise.resolve()),
    });
    const session = makeFakeSession();
    const events: WarmupProgressEvent[] = [];

    const result = await runWarmup(wc, session, ['https://hangs.example', 'https://after.example'], 5, (e) => events.push(e), {
      pageLoadTimeoutMs: 50,
      minSiteBudgetMs: 0,
    });

    // The hung page is reported as an error (not a visit) and the run
    // moves on to the next URL — a hang must not be indistinguishable from
    // a successful visit, and must not wedge the rest of the run.
    expect(result.visited).toBe(1);
    const hangEvent = events.find((e) => e.url === 'https://hangs.example' && e.status === 'error');
    expect(hangEvent?.error).toContain('timed out');
    expect(wc.loadURL).toHaveBeenCalledWith('https://after.example');
  }, 3000);

  it('returns immediately with zero visits/skips for an empty URL list', async () => {
    const wc = makeFakeWebContents();
    const session = makeFakeSession();

    const result = await runWarmup(wc, session, [], 60);

    expect(result).toEqual({ visited: 0, skipped: 0 });
    expect(wc.loadURL).not.toHaveBeenCalled();
  });
});
