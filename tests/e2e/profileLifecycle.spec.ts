import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Drives the real, packaged manager process end-to-end (real Electron main +
 * preload + IPC + SQLite + renderer) — this is what tests/unit and
 * tests/integration cannot cover, since those run repositories directly under
 * plain Node without any IPC boundary in between.
 *
 * Deliberately scoped to profile CRUD/search/filter/export through the actual
 * UI. It does NOT drive a profile's "Start" button, because that spawns a
 * second, independent Electron/Chromium OS process per the architecture in
 * ARCHITECTURE.md — reliably automating a nested Electron launch from inside
 * this harness is tracked as a follow-up in PLAN.md rather than attempted
 * here in a way that could be flaky/misleading.
 */

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-'));
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

test('manager window loads the Profiles page with an empty list', async () => {
  await expect(window.locator('text=No profiles yet')).toBeVisible({ timeout: 15_000 });
});

test('creating a profile adds it to the list with STOPPED status', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Profile One');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  await expect(window.locator('td', { hasText: 'E2E Profile One' })).toBeVisible({ timeout: 15_000 });
  await expect(window.locator('tr', { has: window.locator('td', { hasText: 'E2E Profile One' }) })).toHaveAttribute(
    'data-status',
    'STOPPED',
  );
});

test('Quick create adds a profile immediately, with no modal', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Quick Profile');
  await window.getByRole('button', { name: 'Quick create' }).click();
  await expect(window.locator('td', { hasText: 'E2E Quick Profile' })).toBeVisible({ timeout: 15_000 });
  await expect(window.locator('tr', { has: window.locator('td', { hasText: 'E2E Quick Profile' }) })).toHaveAttribute(
    'data-status',
    'STOPPED',
  );
  // No modal panel should have opened at any point during a quick create.
  await expect(window.locator('.modal-panel')).toHaveCount(0);
});

test('Quick create with an empty name falls back to an auto-generated one', async () => {
  await window.getByPlaceholder('New profile name').fill('');
  const rowsBefore = await window.locator('tbody tr').count();
  await window.getByRole('button', { name: 'Quick create' }).click();
  await expect.poll(() => window.locator('tbody tr').count()).toBeGreaterThan(rowsBefore);
  await expect(window.locator('.modal-panel')).toHaveCount(0);
});

test('search filters the profile list', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Profile Two');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  await expect(window.locator('td', { hasText: 'E2E Profile Two' })).toBeVisible({ timeout: 15_000 });

  await window.getByPlaceholder('Search profiles...').fill('Profile One');
  await expect(window.locator('td', { hasText: 'E2E Profile One' })).toBeVisible();
  await expect(window.locator('td', { hasText: 'E2E Profile Two' })).toHaveCount(0);

  await window.getByPlaceholder('Search profiles...').fill('');
  await expect(window.locator('td', { hasText: 'E2E Profile Two' })).toBeVisible();
});

test('deleting a profile removes it from the list', async () => {
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Profile Two' }) });
  await row.getByRole('button', { name: 'Delete' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(window.locator('td', { hasText: 'E2E Profile Two' })).toHaveCount(0, { timeout: 15_000 });
  await expect(window.locator('td', { hasText: 'E2E Profile One' })).toBeVisible();
});

test('editing a profile shows its fingerprint and allows renaming', async () => {
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Profile One' }) });
  await row.getByRole('button', { name: 'Edit' }).click();

  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('fingerprint', { exact: true }).click();
  await expect(window.locator('th', { hasText: 'User-Agent' })).toBeVisible();
  await window.getByRole('button', { name: 'Validate' }).click();
  await expect(window.locator('p', { hasText: /Valid|Invalid/ })).toBeVisible({ timeout: 10_000 });

  await window.getByText('general', { exact: true }).click();
  await window.getByLabel('Name').fill('E2E Profile One Renamed');
  await window.getByRole('button', { name: 'Save' }).click();
  await window.getByRole('button', { name: 'Close' }).click();

  await expect(window.locator('td', { hasText: 'E2E Profile One Renamed' })).toBeVisible({ timeout: 15_000 });
});

test('navigating to Proxies and Settings pages works', async () => {
  await window.getByText('Proxies', { exact: true }).click();
  await expect(window.locator('text=Add Proxy')).toBeVisible();

  await window.getByText('Settings', { exact: true }).click();
  await expect(window.locator('text=Hardware acceleration')).toBeVisible();

  await window.getByText('Profiles', { exact: true }).click();
  await expect(window.locator('td', { hasText: 'E2E Profile One' })).toBeVisible();
});
