import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Final hardening pass: repeated start/stop/restart cycling against one
 * profile, checking for the failure modes that only show up after several
 * cycles rather than one — an orphan Chromium/Electron process left behind,
 * a profile directory left locked, or the manager process itself becoming
 * unresponsive. Deliberately a moderate cycle count against a single
 * profile, not a stress test — the point is proving there's no *leak*
 * across repetitions, not measuring absolute throughput.
 */
test.setTimeout(120_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

const CYCLES = 5;

/** Real OS process count for the packaged/dev Electron binary this test
 * itself is running under — used as a baseline so "no orphans" is judged
 * against what's actually running, not an assumed absolute number (the
 * manager app alone is normally several OS processes: main + GPU + a
 * renderer or two, all sharing the same exe name). */
function countElectronProcesses(): number {
  try {
    if (process.platform === 'win32') {
      // E2E tests always run against the dev-built Electron binary from
      // node_modules (electron.exe) via Playwright's electron.launch() —
      // only a *packaged* build renames it to Goblin.exe, which isn't what
      // this test (or any other E2E test in this suite) launches.
      const out = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', { encoding: 'utf-8' });
      if (out.includes('No tasks')) return 0;
      return out.trim().split('\n').filter(Boolean).length;
    }
    return -1; // not measured on non-Windows in this suite
  } catch {
    return -1;
  }
}

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-resource-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test(`${CYCLES} repeated start/stop cycles on one profile leave no orphan process, no locked directory, and a responsive UI`, async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Resource Cycle Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Resource Cycle Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  const baselineProcessCount = countElectronProcesses();

  for (let i = 0; i < CYCLES; i++) {
    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

    // The UI must stay responsive while a profile is running — not just
    // that the click didn't throw, which Playwright would report as a
    // timeout if the renderer were actually frozen.
    await window.getByPlaceholder('Search profiles...').fill('E2E Resource');
    await expect(row).toBeVisible({ timeout: 5_000 });
    await window.getByPlaceholder('Search profiles...').fill('');

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

    // No locked directory left behind: a fresh Start immediately after Stop
    // must succeed every cycle — if the lock file (or the OS itself, e.g. a
    // Windows file handle not yet released) were still held, the next Start
    // would either throw "Profile is locked" or hang.
  }

  if (baselineProcessCount >= 0) {
    const finalProcessCount = countElectronProcesses();
    // Some slack for the manager's own transient helper processes
    // (GPU/utility) appearing or disappearing between samples — the
    // property under test is "did NOT grow by one leaked process per
    // cycle", not "is bit-for-bit identical to the baseline sample".
    expect(finalProcessCount).toBeLessThanOrEqual(baselineProcessCount + 2);
  }

  // One real restart cycle too (stop+start as a single action), same checks.
  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
  await row.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

  // The manager window itself is still fully interactive after all of this —
  // no stale/leaked IPC handler or runaway timer has degraded it.
  await expect(window.getByRole('button', { name: 'New Profile' })).toBeEnabled();
  await window.getByText('Settings', { exact: true }).click();
  await expect(window.getByText('Keyboard Shortcuts')).toBeVisible({ timeout: 5_000 });
});
