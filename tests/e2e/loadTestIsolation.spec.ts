import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * Real-world load test — Test 4 (Profile Isolation) from the load-test
 * brief: create the requested >=20 profiles and, for each one, prove real
 * cookie/localStorage/IndexedDB storage is isolated — Profile A can never
 * read Profile B's data.
 *
 * Run SEQUENTIALLY (one real browser at a time, exactly like
 * resourceManagement.spec.ts), not concurrently — unlike the bulk
 * start/stop tests, memory cost here never compounds (only ever one
 * profile's ~585MB of Chromium processes exist at a time), so this file
 * safely reaches the full 20-profile scale the brief asks for, even on a
 * machine that could not sustain 2 simultaneous real browsers (see
 * loadTestBulkStartStop.spec.ts's module comment for that incident).
 *
 * A single pass per profile (not "write then separately verify") proves
 * isolation more strongly than a two-pass design would: immediately after
 * each profile starts, BEFORE writing anything, this asserts its cookie/
 * localStorage/IndexedDB are already empty — i.e. it did not inherit the
 * previous profile's data — and only then writes its own unique marker.
 * That catches leakage in either direction (reading a predecessor's data,
 * or a predecessor reading a successor's) with half the real browser
 * launches a two-pass design would need.
 *
 * Fingerprint uniqueness (every profile gets its own generator seed) is
 * checked at the DB/generator layer in loadTest.test.ts — no browser
 * needed there, see that file's "fingerprint uniqueness" test. Proxy
 * isolation (a profile never uses another's proxy, or a proxy when none is
 * assigned) is already proven for 3 profiles in proxyIsolation.spec.ts;
 * this file does not repeat that mechanism at 20-profile scale since it
 * would need 20 separate fake proxy servers for no additional real
 * evidence of correctness (proxy selection is not profile-count-dependent
 * in the implementation).
 */
test.setTimeout(600_000);

const SCALE = 20;
const REMOTE_DEBUG_PORT = 9345;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;
let server: http.Server;
let serverPort: number;

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body>isolation test page</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverPort = (server.address() as AddressInfo).port;

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-load-isolation-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT) },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  for (let i = 0; i < SCALE; i++) {
    await window.getByPlaceholder('New profile name').fill(`Isolation Profile ${i}`);
    await window.getByRole('button', { name: 'New Profile' }).click();
  }
  await expect(window.locator('tr', { has: window.locator('td', { hasText: /^Isolation Profile/ }) })).toHaveCount(
    SCALE,
    { timeout: 30_000 },
  );
});

test.afterAll(async () => {
  await cdp?.close();
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connectToShell(): Promise<Page> {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const client = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUG_PORT}`);
      for (const ctx of client.contexts()) {
        for (const page of ctx.pages()) {
          if (page.url().includes('browser-shell.html')) {
            cdp = client;
            return page;
          }
        }
      }
      await client.close();
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Could not find browser-shell.html page via CDP: ${String(lastErr)}`);
}

/** Same transient-failure retry as browserTabs.spec.ts / fullUserFlow.spec.ts —
 * `<webview>.executeJavaScript` can race the guest frame's own readiness right
 * after a navigation commits. */
async function execInWebview(webview: ReturnType<Page['locator']>, script: string): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < 20; i++) {
    try {
      return await webview.evaluate(
        (el, s) => (el as unknown as { executeJavaScript: (s: string) => Promise<unknown> }).executeJavaScript(s),
        script,
      );
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

const idbReadScript = `
(function() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('e2e_iso_db', 1);
    req.onupgradeneeded = function() { req.result.createObjectStore('kv'); };
    req.onsuccess = function() {
      var db = req.result;
      var tx = db.transaction('kv', 'readonly');
      var getReq = tx.objectStore('kv').get('marker');
      getReq.onsuccess = function() { resolve(getReq.result === undefined ? null : getReq.result); };
      getReq.onerror = function() { reject(getReq.error); };
    };
    req.onerror = function() { reject(req.error); };
  });
})()
`;

function idbWriteScript(value: string): string {
  return `
(function() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open('e2e_iso_db', 1);
    req.onupgradeneeded = function() { req.result.createObjectStore('kv'); };
    req.onsuccess = function() {
      var db = req.result;
      var tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put('${value}', 'marker');
      tx.oncomplete = function() { resolve('written'); };
      tx.onerror = function() { reject(tx.error); };
    };
    req.onerror = function() { reject(req.error); };
  });
})()
`;
}

interface IsolationResult {
  index: number;
  cookieClean: boolean;
  localStorageClean: boolean;
  indexedDbClean: boolean;
  startMs: number;
}

const results: IsolationResult[] = [];

for (let i = 0; i < SCALE; i++) {
  test(`profile ${i} of ${SCALE - 1}: storage is empty on first use, then isolated after writing a unique marker`, async () => {
    const row = window.locator('tr', { has: window.locator('td', { hasText: new RegExp(`^Isolation Profile ${i}$`) }) });
    const t0 = performance.now();
    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 45_000 });
    const startMs = performance.now() - t0;

    const shell = await connectToShell();
    const address = shell.locator('#address');
    await address.fill(`http://127.0.0.1:${serverPort}/`);
    await address.press('Enter');
    await expect(address).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${serverPort}`), { timeout: 15_000 });
    const webview = shell.locator('webview').first();
    await webview.waitFor({ state: 'attached', timeout: 15_000 });

    // Before writing anything: this profile must NOT see any previous
    // profile's marker. This is the actual isolation proof.
    const cookieBefore = String(await execInWebview(webview, 'document.cookie'));
    const cookieClean = !cookieBefore.includes('e2e_iso_marker=');
    const lsBefore = await execInWebview(webview, "window.localStorage.getItem('e2e_iso_marker')");
    const localStorageClean = lsBefore === null;
    const idbBefore = await execInWebview(webview, idbReadScript);
    const indexedDbClean = idbBefore === null;

    // Now write this profile's own unique marker.
    const marker = `profile-${i}-${Date.now()}`;
    await execInWebview(webview, `document.cookie = "e2e_iso_marker=${marker}; path=/"`);
    await execInWebview(webview, `window.localStorage.setItem('e2e_iso_marker', '${marker}')`);
    await execInWebview(webview, idbWriteScript(marker));

    const cookieAfter = String(await execInWebview(webview, 'document.cookie'));
    expect(cookieAfter).toContain(`e2e_iso_marker=${marker}`);
    const lsAfter = await execInWebview(webview, "window.localStorage.getItem('e2e_iso_marker')");
    expect(lsAfter).toBe(marker);
    const idbAfter = await execInWebview(webview, idbReadScript);
    expect(idbAfter).toBe(marker);

    await cdp?.close();
    cdp = undefined;
    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

    results.push({ index: i, cookieClean, localStorageClean, indexedDbClean, startMs });

    // The real isolation assertions: fail loudly (not silently) if a
    // previous profile's data leaked into this one.
    expect(cookieClean, `profile ${i} inherited a cookie marker from a previous profile`).toBe(true);
    expect(localStorageClean, `profile ${i} inherited a localStorage marker from a previous profile`).toBe(true);
    expect(indexedDbClean, `profile ${i} inherited an IndexedDB marker from a previous profile`).toBe(true);
  });
}

test('write the isolation load-test report', () => {
  expect(results.length).toBe(SCALE);
  const allClean = results.every((r) => r.cookieClean && r.localStorageClean && r.indexedDbClean);
  const avgStartMs = results.reduce((sum, r) => sum + r.startMs, 0) / results.length;
  const lines = [
    '# Load test — profile isolation (raw data)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Profiles tested: ${SCALE} (real, sequential — one real browser running at a time)`,
    `Overall result: ${allClean ? 'PASS — no profile ever saw another profile’s cookie, localStorage, or IndexedDB data' : 'FAIL — isolation leak detected, see per-profile table'}`,
    `Average real browser start time: ${avgStartMs.toFixed(0)}ms`,
    '',
    '| Profile # | Cookie clean on start | localStorage clean on start | IndexedDB clean on start | Start time (ms) |',
    '|---|---|---|---|---|',
    ...results.map(
      (r) => `| ${r.index} | ${r.cookieClean ? 'yes' : 'LEAK'} | ${r.localStorageClean ? 'yes' : 'LEAK'} | ${r.indexedDbClean ? 'yes' : 'LEAK'} | ${r.startMs.toFixed(0)} |`,
    ),
    '',
    '_Real measured numbers from this machine/run — not fabricated._',
    '',
  ];
  fs.writeFileSync(path.join(__dirname, '..', 'performance', 'LOAD_TEST_ISOLATION_RAW.md'), lines.join('\n'), 'utf-8');
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n'));
});
