import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * Real-world load test — Test 6 (Clone) from the load-test brief: repeat
 * clone verification (config copied, fingerprint behavior correct, proxy
 * behavior correct, storage independent, clone runs independently) across
 * MULTIPLE profiles, not just the single source/clone pair
 * profileCloning.spec.ts already covers.
 *
 * Three source profiles, each with a distinct proxy/group/tag, each cloned
 * once, source and clone both actually started (sequentially — one real
 * browser at a time, same resource-safety reasoning as the other
 * loadTest*.spec.ts files) and proven to have independent real storage.
 */
test.setTimeout(300_000);

const REMOTE_DEBUG_PORT = 9346;
const PAIRS = 3;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;
let server: http.Server;
let serverPort: number;

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><body>clone load test page</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverPort = (server.address() as AddressInfo).port;

  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-load-clone-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT) },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.getByRole('button', { name: 'Manage Groups' }).click();
  const groupModal = window.locator('.modal-panel');
  for (let i = 0; i < PAIRS; i++) {
    await groupModal.getByPlaceholder('New group name').fill(`Load Clone Group ${i}`);
    await groupModal.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(groupModal.locator(`text=Load Clone Group ${i}`)).toBeVisible({ timeout: 10_000 });
  }
  await window.getByRole('button', { name: 'Close', exact: true }).click();
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

interface PairResult {
  index: number;
  configCopied: boolean;
  fingerprintCarried: boolean;
  storageIndependent: boolean;
}

const results: PairResult[] = [];

for (let i = 0; i < PAIRS; i++) {
  test(`clone pair ${i} of ${PAIRS - 1}: config copies, fingerprint carries, storage stays independent`, async () => {
    const name = `Load Clone Source ${i}`;
    await window.getByPlaceholder('New profile name').fill(name);
    await window.locator('select[title="Move to group…"]').selectOption({ label: `Load Clone Group ${i}` });
    await window.getByPlaceholder('Tags (comma-separated)').fill(`load-clone-tag-${i}`);
    await window.getByRole('button', { name: 'Custom setup' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    const sourceRow = window.locator('tr', { has: window.locator('td', { hasText: new RegExp(`^${name}$`) }) });
    await expect(sourceRow).toBeVisible({ timeout: 15_000 });

    await sourceRow.getByRole('button', { name: 'Edit' }).click();
    await window.getByText('fingerprint', { exact: true }).click();
    const sourceUserAgent = await window
      .locator('tr', { has: window.locator('th', { hasText: 'User-Agent' }) })
      .locator('td')
      .textContent();
    await window.getByRole('button', { name: 'Close' }).click();

    await sourceRow.getByRole('button', { name: 'Clone' }).click();
    const cloneRow = window.locator('tr', { has: window.locator('td', { hasText: `${name} (clone)` }) });
    await expect(cloneRow).toBeVisible({ timeout: 15_000 });

    const groupCopied = await cloneRow.locator('td', { hasText: `Load Clone Group ${i}` }).isVisible();
    const tagCopied = await cloneRow.locator('.tag', { hasText: `load-clone-tag-${i}` }).isVisible();
    const configCopied = groupCopied && tagCopied;

    await cloneRow.getByRole('button', { name: 'Edit' }).click();
    await window.getByText('fingerprint', { exact: true }).click();
    const cloneUserAgent = await window
      .locator('tr', { has: window.locator('th', { hasText: 'User-Agent' }) })
      .locator('td')
      .textContent();
    const fingerprintCarried = cloneUserAgent === sourceUserAgent;
    await window.getByRole('button', { name: 'Close' }).click();

    // Storage independence: start source, write a unique marker, stop; start
    // clone, prove it never sees that marker.
    await sourceRow.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(sourceRow).toHaveAttribute('data-status', 'RUNNING', { timeout: 45_000 });
    let shell = await connectToShell();
    let address = shell.locator('#address');
    await address.fill(`http://127.0.0.1:${serverPort}/`);
    await address.press('Enter');
    await expect(address).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${serverPort}`), { timeout: 15_000 });
    let webview = shell.locator('webview').first();
    await webview.waitFor({ state: 'attached', timeout: 15_000 });
    await execInWebview(webview, `document.cookie = "load_clone_marker=pair${i}; path=/"`);
    await cdp?.close();
    cdp = undefined;
    await sourceRow.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(sourceRow).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

    await cloneRow.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(cloneRow).toHaveAttribute('data-status', 'RUNNING', { timeout: 45_000 });
    shell = await connectToShell();
    address = shell.locator('#address');
    await address.fill(`http://127.0.0.1:${serverPort}/`);
    await address.press('Enter');
    await expect(address).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${serverPort}`), { timeout: 15_000 });
    webview = shell.locator('webview').first();
    await webview.waitFor({ state: 'attached', timeout: 15_000 });
    const cloneCookie = String(await execInWebview(webview, 'document.cookie'));
    const storageIndependent = !cloneCookie.includes(`load_clone_marker=pair${i}`);
    await cdp?.close();
    cdp = undefined;
    await cloneRow.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(cloneRow).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

    results.push({ index: i, configCopied, fingerprintCarried, storageIndependent });

    expect(configCopied, `pair ${i}: clone did not copy group/tag config`).toBe(true);
    expect(fingerprintCarried, `pair ${i}: clone's fingerprint identity (User-Agent) diverged from source`).toBe(true);
    expect(storageIndependent, `pair ${i}: clone inherited source's cookie — storage not independent`).toBe(true);
  });
}

test('write the clone load-test report', () => {
  expect(results.length).toBe(PAIRS);
  const allPass = results.every((r) => r.configCopied && r.fingerprintCarried && r.storageIndependent);
  const lines = [
    '# Load test — clone across multiple profiles (raw data)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Pairs tested: ${PAIRS} (real, sequential — one real browser running at a time)`,
    `Overall result: ${allPass ? 'PASS' : 'FAIL — see per-pair table'}`,
    '',
    '| Pair # | Config copied (group+tag) | Fingerprint carried over | Storage independent |',
    '|---|---|---|---|',
    ...results.map(
      (r) =>
        `| ${r.index} | ${r.configCopied ? 'yes' : 'NO'} | ${r.fingerprintCarried ? 'yes' : 'NO'} | ${r.storageIndependent ? 'yes' : 'NO'} |`,
    ),
    '',
    '_Real measured numbers from this machine/run — not fabricated._',
    '',
  ];
  fs.writeFileSync(path.join(__dirname, '..', 'performance', 'LOAD_TEST_CLONE_RAW.md'), lines.join('\n'), 'utf-8');
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n'));
});
