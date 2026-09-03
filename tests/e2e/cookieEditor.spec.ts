import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Real, end-to-end coverage of the cookie editor: cookies only exist inside
 * a running profile's own child-process session (ProfileManager.
 * sendChildRequest proxies to it over the existing stdio IPC channel), so
 * this drives a genuinely running profile process, not a mock of that
 * message protocol (see tests/unit/profileCookies.test.ts for that). No
 * artificial settle wait is added after Start on purpose — the very first
 * request right after a profile reports RUNNING is exactly the case
 * sendChildRequest's retry logic exists to cover (see its own comment).
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-cookies-'));
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

test('cookie editor: gated while stopped, then real add/list/delete against a running profile session', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Cookie Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Cookie Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Gated while stopped: no cookie table, just the explanatory message.
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('storage', { exact: true }).click();
  await expect(window.getByText('Start the profile to view or edit its cookies')).toBeVisible();
  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('.modal-panel-lg')).toBeVisible({ timeout: 15_000 });
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('storage', { exact: true }).click();

  // The profile auto-navigates to the default start page on launch, which
  // already sets real cookies — confirms this reads the real session (not
  // a placeholder/empty stub). A generous timeout here specifically covers
  // sendChildRequest's retry window (up to ~5s) for a profile that only
  // just started.
  const cookieTable = window.locator('table', { has: window.locator('th', { hasText: 'Domain' }) });
  await expect(cookieTable.locator('tbody tr').first()).toBeVisible({ timeout: 15_000 });

  // Add one through the real UI form.
  await window.getByPlaceholder('example.com').fill('example.com');
  const nameInputs = window.locator('.panel', { has: window.locator('h4', { hasText: 'Add cookie' }) }).locator('input.mono');
  await nameInputs.nth(1).fill('e2e_test_cookie');
  await nameInputs.nth(2).fill('hello-world');
  await window.getByRole('button', { name: 'Add', exact: true }).click();

  const cookieRow = window.locator('tr', { has: window.locator('td', { hasText: 'e2e_test_cookie' }) });
  await expect(cookieRow).toBeVisible({ timeout: 10_000 });
  await expect(cookieRow.locator('td').nth(2)).toHaveText('hello-world');

  // Delete it and confirm it's really gone (re-fetched from the real
  // session, not just removed from local state) — the real google.com
  // cookies from the default start page stay untouched.
  await cookieRow.getByRole('button').click();
  await expect(cookieRow).toHaveCount(0, { timeout: 10_000 });
  await expect(cookieTable.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 });

  await window.getByRole('button', { name: 'Close' }).click();
  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
