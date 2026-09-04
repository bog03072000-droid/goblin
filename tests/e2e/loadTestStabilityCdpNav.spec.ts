import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Isolated investigation of the open finding flagged in
 * loadTestStability.spec.ts's own module comment and docs/LOAD_TEST.md's
 * Test 5 section: an earlier variant of the stability test that added a
 * real per-cycle `<webview>` page navigation via CDP (instead of just a
 * manager-UI responsiveness check) produced one run where a profile ended a
 * cycle CRASHED — not reproduced by a subsequent non-CDP run of the same
 * 10-cycle sequence, and left unresolved for a dedicated follow-up.
 *
 * This file IS that follow-up: single profile (kept isolated, not the full
 * 2-profile suite, to reduce this test's own resource footprint while
 * investigating), CYCLES real start -> connect via CDP -> navigate via the
 * shell's own address bar -> stop, run REPEATS times to see whether a crash
 * reproduces or not. Findings go straight into docs/LOAD_TEST.md's Test 5
 * section — this file's own job is only to produce that evidence honestly,
 * not to assert a verdict itself.
 */
test.setTimeout(600_000);

const REMOTE_DEBUG_PORT = 9337;
const CYCLES = 10;
const REPEATS = 2;
const PROFILE_NAME = 'CDP Nav Stability Profile';

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-load-stability-cdpnav-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT) },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.getByPlaceholder('New profile name').fill(PROFILE_NAME);
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  await expect(
    window.locator('tr', { has: window.locator('td', { hasText: new RegExp(`^${PROFILE_NAME}$`) }) }),
  ).toBeVisible({ timeout: 15_000 });
});

test.afterAll(async () => {
  await cdp?.close();
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

/** Same reconnect-per-cycle pattern as browserTabs.spec.ts's connectToShell()
 * — the profile's child process (and its CDP port) is a fresh OS process
 * every cycle, so this can't reuse a single long-lived connection. */
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

interface RunResult {
  repeat: number;
  cycleCrashedAt: number | null; // null == no crash this run
  cyclesCompleted: number;
}

const runResults: RunResult[] = [];

for (let repeat = 0; repeat < REPEATS; repeat++) {
  test(`repeat ${repeat + 1}/${REPEATS}: ${CYCLES} real start/CDP-navigate/stop cycles — crash or clean?`, async () => {
    const row = window.locator('tr', { has: window.locator('td', { hasText: new RegExp(`^${PROFILE_NAME}$`) }) });
    let crashedAt: number | null = null;
    let cyclesCompleted = 0;

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      await row.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 45_000 });

      // Real per-cycle navigation via the shell's own address bar, over a
      // fresh CDP connection to this cycle's freshly-spawned child process —
      // not a JS-eval shortcut, the exact mechanism the original finding
      // flagged as the difference from the reverted non-CDP variant.
      const shell = await connectToShell();
      const address = shell.locator('#address');
      const target = cycle % 2 === 0 ? 'https://example.com' : 'https://www.google.com';
      await address.fill(target);
      await address.press('Enter');
      await expect(address).toHaveValue(new RegExp(target.replace('https://', '').replace('www.', '')), {
        timeout: 20_000,
      });
      await cdp?.close();
      cdp = undefined;

      await row.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 }).catch(() => {
        // Swallowed deliberately: if the profile crashed instead of
        // stopping cleanly, the assertion below reads the real status
        // rather than this timeout, so the crash is recorded precisely
        // instead of just failing the whole test opaquely.
      });

      const status = await row.getAttribute('data-status');
      cyclesCompleted = cycle + 1;
      if (status === 'CRASHED' || status === 'ERROR') {
        crashedAt = cycle;
        break;
      }
    }

    runResults.push({ repeat: repeat + 1, cycleCrashedAt: crashedAt, cyclesCompleted });

    // If it crashed, restart it clean so the next repeat (or afterAll) has a
    // stoppable profile to work with, rather than leaving it stuck.
    if (crashedAt !== null) {
      const status = await row.getAttribute('data-status');
      if (status === 'RUNNING') {
        await row.getByRole('button', { name: 'Stop', exact: true }).click().catch(() => {});
      }
    }
  });
}

test('write the CDP-navigation stability findings', () => {
  expect(runResults.length).toBe(REPEATS);
  const anyCrash = runResults.some((r) => r.cycleCrashedAt !== null);
  const lines = [
    '# Load test — stability, real per-cycle CDP navigation (isolated investigation)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Profile: "${PROFILE_NAME}", ${CYCLES} cycles/repeat, ${REPEATS} repeats, real navigation via the shell's own address bar over a fresh CDP connection each cycle (not a JS-eval shortcut).`,
    '',
    '| Repeat | Cycles completed | Crashed at cycle |',
    '|---|---|---|',
    ...runResults.map((r) => `| ${r.repeat} | ${r.cyclesCompleted} | ${r.cycleCrashedAt === null ? '— (clean)' : r.cycleCrashedAt} |`),
    '',
    `Verdict: ${anyCrash ? 'REPRODUCED at least once — see docs/LOAD_TEST.md Test 5 for the updated conclusion.' : 'NOT reproduced across all repeats — see docs/LOAD_TEST.md Test 5 for the updated conclusion.'}`,
    '',
    '_Real measured numbers from this machine/run — not fabricated._',
    '',
  ];
  fs.writeFileSync(
    path.join(__dirname, '..', 'performance', 'LOAD_TEST_STABILITY_CDPNAV_RAW.md'),
    lines.join('\n'),
    'utf-8',
  );
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n'));
});
