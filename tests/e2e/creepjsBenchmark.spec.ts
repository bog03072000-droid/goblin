import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Real-world fingerprint benchmark: starts one normal Goblin profile (same
 * create/start flow a real user goes through — no test-only shortcuts to
 * the fingerprint config itself) and points its real browser window at
 * https://abrahamjuliot.github.io/creepjs/, a public, well-known
 * fingerprinting/automation-detection scanner. Whatever CreepJS reports is
 * captured verbatim (full rendered page text, not a hand-picked subset) —
 * this test does not assert PASS/FAIL on any score, because there is no
 * "correct" score to assert against; it exists purely to produce a real,
 * dated measurement to compare against after any future change to the
 * fingerprint injection mechanism.
 *
 * Network-dependent (a real public site, not a local fixture) — by design,
 * since a local mock can't tell us anything about real-world detectability.
 */
test.setTimeout(120_000);

const REMOTE_DEBUG_PORT = 9348;
const RESULTS_DIR = path.join(__dirname, '..', '..', 'docs', 'creepjs-results');

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-creepjs-'));
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
  fs.rmSync(userDataDir, { recursive: true, force: true });
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

test('a real Goblin profile scanned by CreepJS — captures real, unedited results', async () => {
  await window.getByPlaceholder('New profile name').fill('CreepJS Benchmark Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'CreepJS Benchmark Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Read this profile's own fingerprint config so the saved report says
  // exactly what was being tested, not just "some profile".
  await row.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('fingerprint', { exact: true }).click();
  const fpRows = await window.locator('table tr').evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll('th, td')).map((c) => c.textContent?.trim() ?? '')),
  );
  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 45_000 });

  const shell = await connectToShell();
  const address = shell.locator('#address');

  // A freshly-started profile's webview auto-navigates to its own start
  // page (browser-shell.js's default, google.com) the instant it attaches —
  // navigating to CreepJS immediately risks racing that still-in-flight
  // first load (observed once: did-navigate fired correctly for CreepJS,
  // address bar updated, but the concurrently-resolving initial google.com
  // load then overwrote the actual document content). Waiting for the
  // initial load to actually settle first removes that race.
  await expect(address).not.toHaveValue('', { timeout: 15_000 });
  await shell.waitForTimeout(2_000);

  await address.fill('https://abrahamjuliot.github.io/creepjs/');
  await address.press('Enter');
  await expect(address).toHaveValue(/creepjs/, { timeout: 20_000 });

  const webview = shell.locator('webview').first();
  await webview.waitFor({ state: 'attached', timeout: 15_000 });

  // CreepJS runs its full analysis (canvas/audio/WebGL/headless-heuristics/
  // etc.) asynchronously after load — poll for its results section to
  // actually contain rendered content instead of a fixed guess-timeout.
  let bodyText = '';
  for (let i = 0; i < 30; i++) {
    bodyText = String(await execInWebview(webview, 'document.body.innerText || ""'));
    if (bodyText.length > 2000) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  // Give it a further moment to settle after content first appears — some
  // sections (trust score, fingerprint hash) finalize slightly after the
  // bulk of the page renders.
  await new Promise((r) => setTimeout(r, 5000));
  bodyText = String(await execInWebview(webview, 'document.body.innerText || ""'));

  await shell.screenshot({ path: path.join(RESULTS_DIR, `screenshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`) });

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString();
  const reportPath = path.join(RESULTS_DIR, `${timestamp.replace(/[:.]/g, '-')}.md`);
  const lines = [
    '# CreepJS benchmark — real, unedited capture',
    '',
    `Generated: ${timestamp}`,
    'Target: https://abrahamjuliot.github.io/creepjs/',
    '',
    '## Profile fingerprint configuration under test',
    '',
    '| Field | Value |',
    '|---|---|',
    ...fpRows.filter((r) => r.length === 2).map(([k, v]) => `| ${k} | ${v} |`),
    '',
    '## Raw CreepJS page text (document.body.innerText, verbatim, not interpreted)',
    '',
    '```',
    bodyText,
    '```',
    '',
    '_Real capture from this machine/run — not fabricated or hand-edited. This test makes no PASS/FAIL assertion on the score itself; it exists to produce a comparable, dated baseline._',
    '',
  ];
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  // eslint-disable-next-line no-console
  console.log('\n=== CREEPJS RAW BODY TEXT ===\n' + bodyText + '\n=== END ===\n');
  console.log(`Report saved to ${reportPath}`);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

  // The only real assertion: the page actually loaded and rendered
  // something substantial (proves the run wasn't blocked/empty), not a
  // judgment on the score.
  expect(bodyText.length).toBeGreaterThan(500);
});
