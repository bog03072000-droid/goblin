import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Real, end-to-end coverage of the scheduled-auto-start UI (AdvancedTab.tsx)
 * against a genuine profile row and a real SQLite database — the actual
 * firing behavior (does the scheduler start the profile at the right time)
 * is covered by tests/unit/profileScheduler.test.ts's injectable-`now`
 * tests, which can exercise "is it 09:00 on a Wednesday" without a real
 * E2E test waiting on the real wall clock. This test instead confirms the
 * UI genuinely persists what it looks like it persists.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-schedule-'));
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

test('enabling a schedule, setting a time and days, persists across closing and reopening the editor', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Schedule Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Schedule Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();

  // Off by default — no time/day controls rendered yet.
  await expect(window.getByLabel('Enable scheduled start')).not.toBeChecked();
  await expect(window.getByText('Days', { exact: true })).toHaveCount(0);

  await window.getByLabel('Enable scheduled start').check();
  await expect(window.getByText('Days', { exact: true })).toBeVisible({ timeout: 10_000 });

  // Picking at least one day should clear the "no days selected" warning.
  await expect(window.getByText('Pick at least one day for the schedule to actually run.')).toBeVisible();
  await window.getByRole('button', { name: 'Wed', exact: true }).click();
  await window.getByRole('button', { name: 'Fri', exact: true }).click();
  await expect(window.getByText('Pick at least one day for the schedule to actually run.')).toHaveCount(0);

  const timeInput = window.getByLabel('Time', { exact: true });
  await timeInput.fill('14:30');
  await timeInput.blur();

  // Close and reopen the editor — if the UI is only holding local React
  // state (not a real, persisted profiles:update call), this would reset.
  await window.getByRole('button', { name: 'Close', exact: true }).click();

  // The profiles table itself now shows a "next auto-start" badge next to
  // the row — not just the editor. The exact day shown depends on today's
  // real date (Wed/Fri, whichever comes first), so this only asserts the
  // time and the schedule-badge's own class are present, not a fixed day.
  await expect(row.locator('.schedule-badge')).toBeVisible({ timeout: 10_000 });
  await expect(row.locator('.schedule-badge')).toContainText('14:30');

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();

  await expect(window.getByLabel('Enable scheduled start')).toBeChecked();
  await expect(window.getByLabel('Time', { exact: true })).toHaveValue('14:30');
  await expect(window.getByRole('button', { name: 'Wed', exact: true })).toHaveClass(/btn-primary/);
  await expect(window.getByRole('button', { name: 'Fri', exact: true })).toHaveClass(/btn-primary/);
  await expect(window.getByRole('button', { name: 'Mon', exact: true })).not.toHaveClass(/btn-primary/);
  await window.getByRole('button', { name: 'Close', exact: true }).click();
});

test('bulk "Enable schedule"/"Disable schedule" toggle several selected profiles at once, without setting a time/days', async () => {
  await window.getByText('Profiles', { exact: true }).click();
  for (const name of ['Bulk Schedule A', 'Bulk Schedule B']) {
    await window.getByPlaceholder('New profile name').fill(name);
    await window.getByRole('button', { name: 'New Profile', exact: true }).click();
    await expect(window.locator('td', { hasText: name })).toBeVisible({ timeout: 10_000 });
  }

  const rowA = window.locator('tr', { has: window.locator('td', { hasText: 'Bulk Schedule A' }) });
  const rowB = window.locator('tr', { has: window.locator('td', { hasText: 'Bulk Schedule B' }) });
  await rowA.locator('input[type="checkbox"]').check();
  await rowB.locator('input[type="checkbox"]').check();

  await window.getByRole('button', { name: 'Enable schedule' }).click();
  await expect(window.getByText('Enabled schedule for 2 profile(s)')).toBeVisible({ timeout: 10_000 });

  for (const row of [rowA, rowB]) {
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
    await window.getByText('advanced', { exact: true }).click();
    await expect(window.getByLabel('Enable scheduled start')).toBeChecked();
    // Enabling in bulk never sets a time/days on its own — no next-run badge
    // yet, since there's nothing to compute a next run from.
    await expect(window.getByText('Pick at least one day for the schedule to actually run.')).toBeVisible();
    await window.getByRole('button', { name: 'Close', exact: true }).click();
  }

  await rowA.locator('input[type="checkbox"]').check();
  await rowB.locator('input[type="checkbox"]').check();
  await window.getByRole('button', { name: 'Disable schedule' }).click();
  await expect(window.getByText('Disabled schedule for 2 profile(s)')).toBeVisible({ timeout: 10_000 });

  await rowA.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();
  await expect(window.getByLabel('Enable scheduled start')).not.toBeChecked();
  await window.getByRole('button', { name: 'Close', exact: true }).click();
});

test('switching to "One-time" mode, setting a date/time and a time zone, persists across closing and reopening the editor', async () => {
  await window.getByText('Profiles', { exact: true }).click();
  await window.getByPlaceholder('New profile name').fill('E2E OneTime Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E OneTime Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();
  await window.getByLabel('Enable scheduled start').check();

  // Defaults to Recurring — the time/days UI from the test above.
  await expect(window.getByText('Days', { exact: true })).toBeVisible();

  await window.getByRole('button', { name: 'One-time', exact: true }).click();
  await expect(window.getByText('Days', { exact: true })).toHaveCount(0);
  await expect(window.getByText('Start at', { exact: true })).toBeVisible();
  await expect(window.getByText('Pick a date and time for the schedule to actually run.')).toBeVisible();

  await window.getByLabel('Time zone').selectOption('Asia/Tokyo');
  const oneTimeInput = window.getByLabel('Start at');
  await oneTimeInput.fill('2030-06-15T10:00');
  await oneTimeInput.blur();
  await expect(window.getByText('Pick a date and time for the schedule to actually run.')).toHaveCount(0);
  await expect(window.getByText(/Next run:/)).toBeVisible();

  await window.getByRole('button', { name: 'Close', exact: true }).click();
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();

  await expect(window.getByRole('button', { name: 'One-time', exact: true })).toHaveClass(/btn-primary/);
  await expect(window.getByLabel('Time zone')).toHaveValue('Asia/Tokyo');
  await expect(window.getByLabel('Start at')).toHaveValue('2030-06-15T10:00');
  await window.getByRole('button', { name: 'Close', exact: true }).click();
});

test('a one-time schedule due in the past really auto-starts the profile with no user action, then disables itself so it never fires again', async () => {
  // A short poll interval so this test doesn't wait a real 30s — the exact
  // mechanism tests/unit/profileScheduler.test.ts already covers with an
  // injectable `now`; this is the one place that proves the real, running
  // scheduler (a setInterval in the actual main process, not test code)
  // genuinely calls ProfileManager.start() end to end for a one-time
  // schedule, the same live-firing bar tests/e2e/proxyHealthScheduler-style
  // suites hold their own periodic mechanisms to.
  const userDataDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-schedule-once-'));
  const app2 = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir2}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_PROFILE_SCHEDULE_CHECK_INTERVAL_MS: '1000' },
  });
  try {
    const window2 = await app2.firstWindow();
    await window2.waitForLoadState('domcontentloaded');

    await window2.getByPlaceholder('New profile name').fill('E2E OneTime Fire Profile');
    await window2.getByRole('button', { name: 'Custom setup' }).click();
    await window2.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    const row = window2.locator('tr', { has: window2.locator('td', { hasText: 'E2E OneTime Fire Profile' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(window2.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
    await window2.getByText('advanced', { exact: true }).click();
    await window2.getByLabel('Enable scheduled start').check();
    await window2.getByRole('button', { name: 'One-time', exact: true }).click();

    // The current local minute, truncated to :00 seconds — by the time the
    // 1s-interval scheduler polls again, this instant is already <= now,
    // so it's genuinely due, not a fabricated already-past timestamp
    // written straight to the database.
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const nowMinuteLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const oneTimeInput = window2.getByLabel('Start at');
    await oneTimeInput.fill(nowMinuteLocal);
    await oneTimeInput.blur();

    await window2.getByRole('button', { name: 'Close', exact: true }).click();

    // Real auto-start: no Start button clicked anywhere in this test. This
    // also exercises a real, separate UI gap found live while building this
    // test: ProfilesPage.tsx's poll only used to run while a profile was
    // already visibly STARTING/STOPPING — a background-originated change
    // (this scheduler) skips that step entirely, so the row silently never
    // updated until ProfilesPage.tsx was fixed to also poll while any
    // profile has scheduling enabled at all (see that file's own comment).
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 20_000 });

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 15_000 });

    // scheduleEnabled was turned back off the moment it fired — reopen and
    // confirm the checkbox itself reflects that, not just that it didn't
    // restart within this test's own short window.
    await row.getByRole('button', { name: 'Edit' }).click();
    await expect(window2.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
    await window2.getByText('advanced', { exact: true }).click();
    await expect(window2.getByLabel('Enable scheduled start')).not.toBeChecked();
    await window2.getByRole('button', { name: 'Close', exact: true }).click();

    // Wait past two more poll intervals to prove it genuinely never fires
    // a second time (scheduleEnabled false is what the scheduler itself
    // gates on, not just the UI's own display).
    await window2.waitForTimeout(2500);
    await expect(row).toHaveAttribute('data-status', 'STOPPED');
  } finally {
    await app2.close();
    fs.rmSync(userDataDir2, { recursive: true, force: true });
  }
});
