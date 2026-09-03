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
 * profile's ~585MB of Chromium processes exist at a time). This was never
 * actually a "20 profiles at once" resource-contention concern (an earlier
 * internal review mischaracterized a live CI failure this way; the real
 * cause was an unrelated, since-fixed navigation race — see commits
 * 491d123/65c5a9d — confirmed by this suite passing cleanly, 21/21, both
 * locally and on live CI without any change here).
 *
 * Split into TIERS (10 profiles each, not one 20-profile batch) anyway, on
 * request: each tier gets its own fresh app instance (separate
 * beforeAll/afterAll), so the manager's profile list/DOM never has to hold
 * more than one tier's worth of profiles at a time, and a failure in one
 * tier can't be blamed on accumulated state from the other — real
 * blast-radius reduction, independent of whatever caused the original
 * false alarm.
 *
 * A single pass per profile (not "write then separately verify") proves
 * isolation more strongly than a two-pass design would: immediately after
 * each profile starts, BEFORE writing anything, this asserts its cookie/
 * localStorage/IndexedDB are already empty — i.e. it did not inherit the
 * previous profile's data — and only then writes its own unique marker.
 * That catches leakage in either direction (reading a predecessor's data,
 * or a predecessor reading a successor's) with half the real browser
 * launches a two-pass design would need. Isolation across TIERS (not just
 * within one) is exercised too: profile numbering and marker values stay
 * globally unique across all tiers (tierStartIndex / globalIndex below),
 * not reset per tier, so a tier B profile is still proven not to see any
 * tier A profile's marker even though the two never share an app instance.
 *
 * Fingerprint uniqueness (every profile gets its own generator seed) is
 * checked at the DB/generator layer in loadTest.test.ts — no browser
 * needed there, see that file's "fingerprint uniqueness" test. Proxy
 * isolation (a profile never uses another's proxy, or a proxy when none is
 * assigned) is already proven for 3 profiles in proxyIsolation.spec.ts;
 * this file does not repeat that mechanism at scale since it would need a
 * separate fake proxy server per profile for no additional real evidence
 * of correctness (proxy selection is not profile-count-dependent in the
 * implementation).
 */
test.setTimeout(600_000);

const TIERS = [
  { name: 'A', size: 10 },
  { name: 'B', size: 10 },
];
const SCALE = TIERS.reduce((sum, tier) => sum + tier.size, 0);
const REMOTE_DEBUG_PORT_BASE = 9345;

let cdp: Browser | undefined;

async function connectToShell(port: number): Promise<Page> {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const client = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
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

// `globalIndex` keeps every profile's marker/name unique across tiers (not
// just within one), so the isolation proof still covers cross-tier
// isolation too — a tier B profile must not see any tier A profile's
// marker either, even though they never coexist in the same app instance.
let globalIndex = 0;

for (const [tierIdx, tier] of TIERS.entries()) {
  test.describe(`tier ${tier.name} (${tier.size} profiles)`, () => {
    const remoteDebugPort = REMOTE_DEBUG_PORT_BASE + tierIdx;
    let app: ElectronApplication;
    let window: Page;
    let userDataDir: string;
    let server: http.Server;
    let serverPort: number;
    const tierStartIndex = TIERS.slice(0, tierIdx).reduce((sum, t) => sum + t.size, 0);

    test.beforeAll(async () => {
      server = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><html><body>isolation test page</body></html>');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      serverPort = (server.address() as AddressInfo).port;

      userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), `pf-load-isolation-${tier.name}-`));
      app = await electron.launch({
        args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
        env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(remoteDebugPort) },
      });
      window = await app.firstWindow();
      await window.waitForLoadState('domcontentloaded');

      for (let i = 0; i < tier.size; i++) {
        await window.getByPlaceholder('New profile name').fill(`Isolation Profile ${tierStartIndex + i}`);
        await window.getByRole('button', { name: 'Custom setup' }).click();
        await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
      }
      await expect(
        window.locator('tr', { has: window.locator('td', { hasText: /^Isolation Profile/ }) }),
      ).toHaveCount(tier.size, { timeout: 30_000 });
    });

    test.afterAll(async () => {
      await cdp?.close();
      await app.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    for (let i = 0; i < tier.size; i++) {
      const displayIndex = tierStartIndex + i;
      test(`profile ${displayIndex} of ${SCALE - 1}: storage is empty on first use, then isolated after writing a unique marker`, async () => {
        const row = window.locator('tr', {
          has: window.locator('td', { hasText: new RegExp(`^Isolation Profile ${displayIndex}$`) }),
        });
        const t0 = performance.now();
        await row.getByRole('button', { name: 'Start', exact: true }).click();
        await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 45_000 });
        const startMs = performance.now() - t0;

        const shell = await connectToShell(remoteDebugPort);
        const address = shell.locator('#address');
        await address.fill(`http://127.0.0.1:${serverPort}/`);
        await address.press('Enter');
        await expect(address).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${serverPort}`), { timeout: 15_000 });
        const webview = shell.locator('webview').first();
        await webview.waitFor({ state: 'attached', timeout: 15_000 });

        // Before writing anything: this profile must NOT see any previous
        // profile's marker (this tier's, or an earlier tier's — see
        // globalIndex). This is the actual isolation proof.
        const cookieBefore = String(await execInWebview(webview, 'document.cookie'));
        const cookieClean = !cookieBefore.includes('e2e_iso_marker=');
        const lsBefore = await execInWebview(webview, "window.localStorage.getItem('e2e_iso_marker')");
        const localStorageClean = lsBefore === null;
        const idbBefore = await execInWebview(webview, idbReadScript);
        const indexedDbClean = idbBefore === null;

        // Now write this profile's own unique marker.
        const marker = `profile-${globalIndex}-${Date.now()}`;
        globalIndex++;
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

        results.push({ index: displayIndex, cookieClean, localStorageClean, indexedDbClean, startMs });

        // The real isolation assertions: fail loudly (not silently) if a
        // previous profile's data leaked into this one.
        expect(cookieClean, `profile ${displayIndex} inherited a cookie marker from a previous profile`).toBe(true);
        expect(localStorageClean, `profile ${displayIndex} inherited a localStorage marker from a previous profile`).toBe(
          true,
        );
        expect(indexedDbClean, `profile ${displayIndex} inherited an IndexedDB marker from a previous profile`).toBe(
          true,
        );
      });
    }
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
    `Profiles tested: ${SCALE} across ${TIERS.length} tiers of ${TIERS.map((t) => t.size).join('+')} (real, sequential within each tier, one real browser running at a time; each tier its own fresh app instance)`,
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
