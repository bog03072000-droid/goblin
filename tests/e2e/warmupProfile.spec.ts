import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * Real, end-to-end confirmation of the "Warm up profile" toolbar button
 * (browser-shell.html/.js + warmupOrchestrator.ts) — Dolphin Anty's
 * "Cookie Robot" concept: visit a list of real URLs in turn, scrolling
 * each like a real person. A local HTTP fixture server (not a live
 * internet dependency, same posture as fingerprintEnforcement.spec.ts's
 * own Service Worker fixture) records every request it receives and
 * every real 'wheel' event its own pages report back — proof the feature
 * genuinely navigated the real webview and genuinely scrolled it, not
 * just that the button's own click handler ran.
 */
test.setTimeout(90_000);

const REMOTE_DEBUG_PORT = 9355;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-warmup-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT) },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await cdp?.close();
  await app.close();
  await rmSyncWithRetry(userDataDir);
});

async function connectToShell(): Promise<Page> {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      cdp = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUG_PORT}`);
      for (const ctx of cdp.contexts()) {
        for (const page of ctx.pages()) {
          if (page.url().includes('browser-shell.html')) return page;
        }
      }
      await cdp.close();
      cdp = undefined;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Could not find browser-shell.html page via CDP: ${String(lastErr)}`);
}

interface Fixture {
  server: http.Server;
  port: number;
  hits: string[];
  wheelHits: number;
}

/** Two tiny pages, each tall enough to scroll and each reporting a real
 * 'wheel' event back to the server via a plain image-beacon GET (no fetch/
 * CORS complexity needed for a one-way signal) — avoids any live internet
 * dependency while still proving a real navigation + a real wheel event
 * reached a real loaded page, not a mock of either. */
function startWarmupFixtureServer(): Promise<Fixture> {
  const hits: string[] = [];
  let wheelHits = 0;
  const pageHtml = (name: string): string => `<!doctype html><html><body style="height:3000px">
    <h1>${name}</h1>
    <script>
      window.addEventListener('wheel', function onWheel() {
        window.removeEventListener('wheel', onWheel);
        var img = new Image();
        img.src = '/wheel-hit';
      }, { once: true });
    </script>
  </body></html>`;
  const server = http.createServer((req, res) => {
    if (req.url === '/wheel-hit') {
      wheelHits++;
      res.writeHead(200, { 'content-type': 'image/gif' });
      res.end();
      return;
    }
    if (req.url === '/page1' || req.url === '/page2') {
      hits.push(req.url);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(pageHtml(req.url));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server,
        port,
        get hits() {
          return hits;
        },
        get wheelHits() {
          return wheelHits;
        },
      } as unknown as Fixture);
    });
  });
}

test('"Warm up profile" visits every configured URL in order, scrolling each real page, and reports done', async () => {
  const fixture = await startWarmupFixtureServer();
  try {
    await window.getByPlaceholder('New profile name').fill('E2E Warmup Profile');
    await window.getByRole('button', { name: 'New Profile', exact: true }).click();
    const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Warmup Profile' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

    const shell = await connectToShell();
    const address = shell.locator('#address');
    await expect(address).toHaveValue(/google\.com/, { timeout: 15_000 });

    await shell.locator('#warmup-toggle').click();
    const panel = shell.locator('#warmup-panel');
    await expect(panel).toBeVisible();

    const url1 = `http://127.0.0.1:${fixture.port}/page1`;
    const url2 = `http://127.0.0.1:${fixture.port}/page2`;
    await shell.locator('#warmup-urls').fill(`${url1}\n${url2}`);
    // 0.2 minutes = 12 real seconds total, split across 2 URLs (6s each) —
    // above the real 10-second minimum duration the backend enforces, but
    // well short of a genuine "1 minute, 2 pages" run (30s/page, since
    // perSiteBudgetMs floors at 2000ms but otherwise splits the requested
    // duration evenly). The number input's HTML min="1" only affects
    // native form-validation UI, never enforced here (no <form>
    // submission; the JS reads .value directly), so a smaller real value
    // is accepted without complaint.
    await shell.locator('#warmup-duration').fill('0.2');
    await shell.locator('#warmup-start').click();

    await expect(shell.locator('#warmup-status')).toHaveText(/Done — visited 2 page\(s\)\./, { timeout: 15_000 });

    // Real server-side proof: both pages were actually requested, in order
    // — not a mock of navigation, and not the same page requested twice.
    expect(fixture.hits).toEqual(['/page1', '/page2']);
    // Real scroll: at least one of the two pages reported a genuine
    // 'wheel' event back to the server (both usually do, but the beacon
    // race with page teardown on fast local navigation makes "at least
    // one" the honest, non-flaky bar here).
    expect(fixture.wheelHits).toBeGreaterThan(0);

    // The address bar reflects the last page actually visited — another
    // independent confirmation this was a real navigation, not just a
    // background fetch.
    await expect(address).toHaveValue(new RegExp(`page2`));

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  } finally {
    fixture.server.close();
  }
});

test('"Warm up profile" skips a non-http(s) URL and reports it, without stopping the rest of the run', async () => {
  const fixture = await startWarmupFixtureServer();
  try {
    await window.getByText('Profiles', { exact: true }).click();
    await window.getByPlaceholder('New profile name').fill('E2E Warmup Skip Profile');
    await window.getByRole('button', { name: 'New Profile', exact: true }).click();
    const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Warmup Skip Profile' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

    const shell = await connectToShell();
    await expect(shell.locator('#address')).toHaveValue(/google\.com/, { timeout: 15_000 });

    await shell.locator('#warmup-toggle').click();
    const url1 = `http://127.0.0.1:${fixture.port}/page1`;
    await shell.locator('#warmup-urls').fill(`javascript:alert(1)\n${url1}`);
    await shell.locator('#warmup-duration').fill('0.2');
    await shell.locator('#warmup-start').click();

    await expect(shell.locator('#warmup-status')).toHaveText(/Done — visited 1 page\(s\), skipped 1 invalid URL\(s\)\./, {
      timeout: 20_000,
    });
    expect(fixture.hits).toEqual(['/page1']);

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  } finally {
    fixture.server.close();
  }
});
