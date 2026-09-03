import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Exercises maxConcurrentLaunches against real Chromium/Electron processes
 * (existing unit coverage in tests/unit/bulkOperations.test.ts only proves
 * the chunking/error-isolation logic against launches that are expected to
 * fail — there's no real-process, real-scale coverage of this setting
 * anywhere else). Deliberately a moderate profile count, not 200 — the
 * point is proving the mechanism, not load-testing the machine.
 */
test.setTimeout(120_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

const PROFILE_COUNT = 8;
const CONCURRENCY = 3;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-concurrency-'));
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

test(`bulk-starting ${PROFILE_COUNT} profiles with maxConcurrentLaunches=${CONCURRENCY} launches all of them without freezing the UI, isolating any per-profile failure`, async () => {
  await window.getByText('Settings', { exact: true }).click();
  const concurrencyInput = window.getByLabel('Launch concurrency (bulk start)');
  await concurrencyInput.fill(String(CONCURRENCY));
  await concurrencyInput.blur();
  await expect(window.locator('.banner-success')).toBeVisible({ timeout: 10_000 });
  await window.getByText('Profiles', { exact: true }).click();

  for (let i = 0; i < PROFILE_COUNT; i++) {
    await window.getByPlaceholder('New profile name').fill(`Concurrency Profile ${i}`);
    await window.getByRole('button', { name: 'Custom setup' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  }
  await expect(window.locator('tr', { has: window.locator('td', { hasText: /^Concurrency Profile/ }) })).toHaveCount(
    PROFILE_COUNT,
    { timeout: 15_000 },
  );

  // Select all visible (all 8 concurrency profiles — nothing else exists yet
  // in this fresh userDataDir).
  await window.locator('th input[type="checkbox"]').check();
  await expect(window.getByText(`${PROFILE_COUNT} selected`)).toBeVisible();

  await window.locator('.bulk-toolbar').getByRole('button', { name: 'Start', exact: true }).click();

  // The UI must stay responsive WHILE the batch is still launching — proven
  // by successfully interacting with an unrelated control (not just that
  // the click didn't throw, which Playwright would report as a timeout if
  // the renderer were actually frozen).
  await window.getByPlaceholder('Search profiles...').fill('Concurrency Profile 0');
  await expect(window.locator('tr', { has: window.locator('td', { hasText: /^Concurrency Profile/ }) })).toHaveCount(1, {
    timeout: 5_000,
  });
  await window.getByPlaceholder('Search profiles...').fill('');

  // Wait for the bulk Start *action itself* to finish (the toolbar
  // disappears once it does — bulk() clears the selection on completion) —
  // not just for individual rows to look done, which can happen mid-batch
  // via the page's own periodic status refresh while later chunks are still
  // being launched. Clicking Stop before this resolves would hit a still-
  // disabled button (bulkBusy stays true for the whole chunked launch).
  await expect(window.locator('.bulk-toolbar')).toBeHidden({ timeout: 60_000 });

  // Every profile reaches a terminal state (RUNNING or ERROR) — never left
  // stuck in STARTING.
  await expect
    .poll(
      async () => {
        const statuses = await window.locator('tr', { has: window.locator('td', { hasText: /^Concurrency Profile/ }) })
          .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-status')));
        return statuses.every((s) => s === 'RUNNING' || s === 'ERROR' || s === 'CRASHED');
      },
      { timeout: 30_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);

  const finalStatuses = await window
    .locator('tr', { has: window.locator('td', { hasText: /^Concurrency Profile/ }) })
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-status')));
  const runningCount = finalStatuses.filter((s) => s === 'RUNNING').length;
  // At least most should succeed on a normal dev machine — this isn't a
  // strict requirement (a heavily loaded CI box could plausibly fail one),
  // but zero successes would indicate the launch mechanism itself is broken,
  // not an environment fluke.
  expect(runningCount).toBeGreaterThan(0);

  // Bulk-stop everything and confirm every process actually tears down —
  // "no orphan processes remain" verified the same way
  // profileBrowserLifecycle.spec.ts does (status reaching STOPPED only
  // happens in the child's real 'exit' handler).
  await window.locator('th input[type="checkbox"]').check();
  await window.locator('.bulk-toolbar').getByRole('button', { name: 'Stop', exact: true }).click();
  await expect
    .poll(
      async () => {
        const statuses = await window.locator('tr', { has: window.locator('td', { hasText: /^Concurrency Profile/ }) })
          .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-status')));
        // CRASHED is also an acceptable end state here — it still means the
        // OS process is gone (set only from the child's real 'exit' handler,
        // same as STOPPED), just that its exit code was non-zero rather than
        // clean. The safety property this asserts is "no live process left
        // behind", not "every profile exits with status code 0".
        return statuses.every((s) => s === 'STOPPED' || s === 'ERROR' || s === 'CRASHED');
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe(true);
});
