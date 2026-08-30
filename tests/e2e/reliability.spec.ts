import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Covers the "must fail gracefully" scenarios from the reliability pass:
 * a blocked destructive action surfaces a clear message rather than
 * crashing or silently no-op'ing, duplicate input doesn't corrupt state,
 * and a profile configured to route through a dead proxy still starts and
 * stops cleanly instead of taking the whole app down with it. */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-reliability-'));
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

test('deleting a running profile is blocked with a clear message, not silently ignored or crashed', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Running Delete Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Running Delete Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  await row.getByRole('button', { name: 'Delete' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Delete', exact: true }).click();

  // A real, human-readable failure banner — not a raw stack trace, not a
  // silent no-op, and critically: the profile is still there afterwards.
  await expect(window.locator('.banner-error')).toContainText('Stop the profile', { timeout: 10_000 });
  await expect(row).toHaveAttribute('data-status', 'RUNNING');
  await expect(window.locator('td', { hasText: 'E2E Running Delete Profile' })).toBeVisible();

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

  // Now that it's stopped, the exact same action succeeds.
  await row.getByRole('button', { name: 'Delete' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(window.locator('td', { hasText: 'E2E Running Delete Profile' })).toHaveCount(0, { timeout: 15_000 });
});

test('duplicate profile names are accepted without corrupting the list (no uniqueness constraint on name)', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Duplicate Name');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await window.getByPlaceholder('New profile name').fill('E2E Duplicate Name');
  await window.getByRole('button', { name: 'New Profile' }).click();

  await expect(window.locator('td', { hasText: 'E2E Duplicate Name' })).toHaveCount(2, { timeout: 15_000 });

  // Each row is still independently addressable and controllable by its own
  // row despite sharing a display name — proves they're distinct records,
  // not one profile rendered twice or a name collision that merged them.
  const rows = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Duplicate Name' }) });
  await rows.nth(0).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(rows.nth(0)).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
  await expect(rows.nth(1)).toHaveAttribute('data-status', 'STOPPED');

  await rows.nth(0).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(rows.nth(0)).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('a profile assigned to an unreachable proxy still starts and stops cleanly instead of taking the app down', async () => {
  await window.getByText('Proxies', { exact: true }).click();
  await window.getByPlaceholder('Name', { exact: true }).fill('E2E Dead Proxy');
  await window.getByPlaceholder('Host').fill('127.0.0.1');
  await window.getByPlaceholder('Port').fill('1'); // nothing listens on port 1
  await window.getByRole('button', { name: 'Add Proxy' }).click();
  await expect(window.locator('td', { hasText: 'E2E Dead Proxy' })).toBeVisible({ timeout: 10_000 });

  await window.getByText('Profiles', { exact: true }).click();
  await window.getByPlaceholder('New profile name').fill('E2E Dead Proxy Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Dead Proxy Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('proxy', { exact: true }).click();
  await window.getByLabel('Assigned proxy').selectOption({ label: 'E2E Dead Proxy (http://127.0.0.1:1)' });
  await window.getByRole('button', { name: 'Save' }).click();
  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

  // The manager window itself never went down — still fully interactive.
  await expect(window.getByRole('button', { name: 'New Profile' })).toBeEnabled();
});
