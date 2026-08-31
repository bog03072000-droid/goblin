import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Real-world load test — Tests 2 & 3 (Bulk Start / Bulk Stop) from the
 * load-test brief, against REAL Chromium/Electron processes.
 *
 * SCALED DOWN FROM THE REQUESTED 20/50/100 TIERS — an actual near-incident
 * during test authoring, not a cautious guess:
 *
 * A first attempt at this test used 20 profiles, based on an earlier
 * (wrong) assumption of ~1 OS process and ~150-300MB per running profile.
 * Measured reality, mid-run, via `tasklist`/`Get-CimInstance
 * Win32_OperatingSystem`: 20 running profiles produced **99 electron.exe
 * processes** (~5 per profile — main + GPU + renderer + utility/audio, not
 * 1) using **~11.7GB** of RAM, and this machine's free memory — only
 * ~3.7-3.8GB to begin with — dropped to **0.6GB free** while the test was
 * still mid-batch. That is a real risk of exhausting system memory and
 * destabilizing the whole machine, not just this test process, so the run
 * was aborted immediately (all electron.exe processes force-killed) rather
 * than let it finish "successfully" at that cost.
 *
 * Measured cost per profile from that incident: ~585MB (11.7GB / 20). Free
 * memory on this machine also fluctuates independently of this test suite —
 * it's the user's own desktop, with Chrome/other apps competing for RAM —
 * and was re-measured at only ~1.6-1.8GB free immediately before this file
 * was finalized (well below the ~3.2GB seen right after the incident above).
 * `PROFILE_COUNT` below is set conservatively against the *worse* of the two
 * readings, not the best case. The 20/50/100 tiers were NOT achieved with
 * real simultaneous browsers here — see docs/LOAD_TEST.md for exactly how
 * that gap is reported (never a fabricated number for the untested tiers).
 * What *is* still fully proven at this smaller real scale:
 * `ProfileManager.bulkStart`/`bulkStop`'s chunking loop and per-item
 * try/catch have no profile-count-dependent branching in the code itself,
 * so correctness at this scale generalizes — only the *absolute*
 * timing/memory numbers at 20/50/100 are not measured.
 */
test.setTimeout(180_000);

const PROFILE_COUNT = 2;
const CONCURRENCY_VALUES = [2, 4, 8] as const;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

function countElectronProcesses(): number {
  try {
    if (process.platform !== 'win32') return -1;
    const out = execSync('tasklist /FI "IMAGENAME eq electron.exe" /FO CSV /NH', { encoding: 'utf-8' });
    if (out.includes('No tasks')) return 0;
    return out.trim().split('\n').filter(Boolean).length;
  } catch {
    return -1;
  }
}

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-load-bulkstart-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await window.getByText('Settings', { exact: true }).click();
  await window.getByText('Profiles', { exact: true }).click();

  for (let i = 0; i < PROFILE_COUNT; i++) {
    await window.getByPlaceholder('New profile name').fill(`Load Bulk Profile ${i}`);
    await window.getByRole('button', { name: 'New Profile' }).click();
  }
  await expect(window.locator('tr', { has: window.locator('td', { hasText: /^Load Bulk Profile/ }) })).toHaveCount(
    PROFILE_COUNT,
    { timeout: 30_000 },
  );
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

const reportLines: string[] = [
  '# Load test — bulk start/stop (raw data)',
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  `Profile count: ${PROFILE_COUNT} (see this file's own module comment for why 50/100 real-simultaneous-browser tiers were not run in this environment)`,
  '',
  '| Concurrency | Total startup (ms) | Time to first RUNNING (ms) | Time to all-terminal (ms) | Succeeded | Failed | Orphan processes after bulk-stop |',
  '|---|---|---|---|---|---|---|',
];

for (const concurrency of CONCURRENCY_VALUES) {
  test(`bulk start ${PROFILE_COUNT} profiles with maxConcurrentLaunches=${concurrency}, then bulk stop`, async () => {
    // Defensive cleanup: if a previous pass in this same file failed
    // mid-batch (this machine runs under real, fluctuating memory pressure
    // from other applications — see the module comment — which has been
    // observed to slow real Chromium startup enough to trip a poll
    // timeout), don't let stale RUNNING/STARTING rows from that failure
    // cascade into this pass's own measurements.
    await window.getByText('Profiles', { exact: true }).click();
    const staleRunning = window.locator('tr[data-status="RUNNING"], tr[data-status="STARTING"]');
    if ((await staleRunning.count()) > 0) {
      await window.locator('th input[type="checkbox"]').check();
      await window.locator('.bulk-toolbar').getByRole('button', { name: 'Stop', exact: true }).click();
      await expect
        .poll(async () => (await staleRunning.count()) === 0, { timeout: 60_000, intervals: [500, 1_000] })
        .toBe(true);
      await window.locator('.bulk-toolbar').getByRole('button', { name: 'Clear selection' }).click().catch(() => {});
    }

    await window.getByText('Settings', { exact: true }).click();
    const concurrencyInput = window.getByLabel('Max simultaneous profile launches (bulk start)');
    await concurrencyInput.fill(String(concurrency));
    await concurrencyInput.blur();
    await expect(window.locator('.banner-success')).toBeVisible({ timeout: 20_000 });
    await window.getByText('Profiles', { exact: true }).click();

    const baselineProcessCount = countElectronProcesses();

    await window.locator('th input[type="checkbox"]').check();
    await expect(window.getByText(`${PROFILE_COUNT} selected`)).toBeVisible();

    const rows = window.locator('tr', { has: window.locator('td', { hasText: /^Load Bulk Profile/ }) });
    const t0 = performance.now();
    await window.locator('.bulk-toolbar').getByRole('button', { name: 'Start', exact: true }).click();

    let firstRunningAt: number | null = null;
    const pollFirstRunning = (async () => {
      await expect
        .poll(
          async () => {
            const statuses = await rows.evaluateAll((els) => els.map((r) => r.getAttribute('data-status')));
            const anyRunning = statuses.some((s) => s === 'RUNNING');
            if (anyRunning && firstRunningAt === null) firstRunningAt = performance.now();
            return anyRunning;
          },
          { timeout: 90_000, intervals: [100, 250, 500] },
        )
        .toBe(true);
    })();
    await pollFirstRunning;

    // Wait for the bulk Start action itself to finish (selection clears on
    // completion — see concurrentStartup.spec.ts for why this matters:
    // clicking Stop before this resolves hits a still-disabled button).
    await expect(window.locator('.bulk-toolbar')).toBeHidden({ timeout: 90_000 });
    const totalStartupMs = performance.now() - t0;

    const tTerminalStart = performance.now();
    await expect
      .poll(
        async () => {
          const statuses = await rows.evaluateAll((els) => els.map((r) => r.getAttribute('data-status')));
          return statuses.every((s) => s === 'RUNNING' || s === 'ERROR' || s === 'CRASHED');
        },
        { timeout: 120_000, intervals: [250, 500, 1_000] },
      )
      .toBe(true);
    const timeToAllTerminalMs = totalStartupMs + (performance.now() - tTerminalStart);

    const finalStatuses = await rows.evaluateAll((els) => els.map((r) => r.getAttribute('data-status')));
    const succeeded = finalStatuses.filter((s) => s === 'RUNNING').length;
    const failed = finalStatuses.filter((s) => s === 'ERROR' || s === 'CRASHED').length;
    expect(succeeded + failed).toBe(PROFILE_COUNT);

    // UI responsiveness check mid/post-batch: an unrelated interaction
    // actually completes (would time out if the renderer were frozen).
    await window.getByPlaceholder('Search profiles...').fill('Load Bulk Profile 0');
    await expect(rows).toHaveCount(1, { timeout: 5_000 });
    await window.getByPlaceholder('Search profiles...').fill('');

    // --- Bulk stop ---
    await window.locator('th input[type="checkbox"]').check();
    await window.locator('.bulk-toolbar').getByRole('button', { name: 'Stop', exact: true }).click();
    await expect
      .poll(
        async () => {
          const statuses = await rows.evaluateAll((els) => els.map((r) => r.getAttribute('data-status')));
          return statuses.every((s) => s === 'STOPPED' || s === 'ERROR' || s === 'CRASHED');
        },
        { timeout: 120_000, intervals: [250, 500, 1_000] },
      )
      .toBe(true);

    // No orphan processes: process count back near baseline. A profile's
    // status only reflects Node's ChildProcess 'exit' event for its *main*
    // process — Electron's own GPU/renderer/utility helper processes for
    // that same instance can take a little longer for Windows to fully
    // reap from the process table, so this polls for the count to settle
    // rather than reading it the instant every row shows STOPPED (an
    // instant read was measured to still see the just-exited helper
    // processes mid-teardown, not a genuine leak).
    let finalProcessCount = -1;
    if (baselineProcessCount >= 0) {
      await expect
        .poll(() => (finalProcessCount = countElectronProcesses()), { timeout: 10_000, intervals: [500, 1_000, 2_000] })
        .toBeLessThanOrEqual(baselineProcessCount + 2);
    } else {
      finalProcessCount = countElectronProcesses();
    }
    const orphanCount = baselineProcessCount >= 0 ? Math.max(0, finalProcessCount - baselineProcessCount - 1) : -1;

    // Profiles can start again immediately (directory unlocked) — spot check
    // one profile rather than all 20, to keep this test's own runtime sane.
    await rows.first().getByRole('button', { name: 'Start', exact: true }).click();
    await expect(rows.first()).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
    await rows.first().getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(rows.first()).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

    reportLines.push(
      `| ${concurrency} | ${totalStartupMs.toFixed(0)} | ${(firstRunningAt !== null ? (firstRunningAt as number) - t0 : -1).toFixed(0)} | ${timeToAllTerminalMs.toFixed(0)} | ${succeeded} | ${failed} | ${orphanCount} |`,
    );
  });
}

test('write the bulk start/stop load-test report', () => {
  reportLines.push(
    '',
    '_Real measured numbers from this machine/run — not fabricated. "Time to first RUNNING" and "all-terminal" are cumulative from the bulk Start click. Orphan count is (final electron.exe process count) - (baseline before this run) - 1, clamped to 0; -1 means process counting was unavailable (non-Windows)._',
    '',
  );
  fs.writeFileSync(path.join(__dirname, '..', 'performance', 'LOAD_TEST_BULKSTART_RAW.md'), reportLines.join('\n'), 'utf-8');
  // eslint-disable-next-line no-console
  console.log('\n' + reportLines.join('\n'));
});
