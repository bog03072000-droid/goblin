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

  const timeInput = window.getByLabel('Time');
  await timeInput.fill('14:30');
  await timeInput.blur();

  // Close and reopen the editor — if the UI is only holding local React
  // state (not a real, persisted profiles:update call), this would reset.
  await window.getByRole('button', { name: 'Close', exact: true }).click();
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();

  await expect(window.getByLabel('Enable scheduled start')).toBeChecked();
  await expect(window.getByLabel('Time')).toHaveValue('14:30');
  await expect(window.getByRole('button', { name: 'Wed', exact: true })).toHaveClass(/btn-primary/);
  await expect(window.getByRole('button', { name: 'Fri', exact: true })).toHaveClass(/btn-primary/);
  await expect(window.getByRole('button', { name: 'Mon', exact: true })).not.toHaveClass(/btn-primary/);
});
