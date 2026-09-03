import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-groups-'));
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

test('groups can be created, a profile moved into one, renamed, filtered, and deleted — via a real modal, not prompt()', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Group Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Group Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Create — the modal itself, not a native prompt() dialog.
  await window.getByRole('button', { name: 'Manage Groups' }).click();
  const modal = window.locator('.modal-panel');
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('New group name').fill('E2E Group');
  await modal.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(modal.locator('text=E2E Group')).toBeVisible({ timeout: 10_000 });
  await expect(modal.locator('text=(0)')).toBeVisible();

  // Rename — inline edit inside the modal.
  await modal.getByRole('button', { name: 'Rename' }).click();
  const renameInput = modal.locator('input').last();
  await renameInput.fill('E2E Group Renamed');
  await renameInput.press('Enter');
  await expect(modal.locator('text=E2E Group Renamed')).toBeVisible({ timeout: 10_000 });

  await window.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toBeHidden();

  // Move the profile into the group via the profile editor (existing wiring).
  await row.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('general', { exact: true }).click();
  await window.getByLabel('Group').selectOption({ label: 'E2E Group Renamed' });
  await window.getByRole('button', { name: 'Save' }).click();
  await window.getByRole('button', { name: 'Close' }).click();

  // Filter by group shows it; "Ungrouped" no longer does.
  await window.locator('select').filter({ hasText: 'All groups' }).selectOption({ label: 'E2E Group Renamed (1)' });
  await expect(window.locator('td', { hasText: 'E2E Group Profile' })).toBeVisible({ timeout: 10_000 });

  await window.locator('select').filter({ hasText: 'All groups' }).selectOption({ label: 'Ungrouped' });
  await expect(window.locator('td', { hasText: 'E2E Group Profile' })).toHaveCount(0);

  await window.locator('select').filter({ hasText: 'All groups' }).selectOption({ label: 'All groups' });
  await expect(window.locator('td', { hasText: 'E2E Group Profile' })).toBeVisible();

  // Delete — goes through the shared ConfirmDialog, not window.confirm().
  await window.getByRole('button', { name: 'Manage Groups' }).click();
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Delete', exact: true }).click();
  await window.locator('.modal-panel').last().getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(modal.locator('text=E2E Group Renamed')).toHaveCount(0, { timeout: 10_000 });
  await window.getByRole('button', { name: 'Close', exact: true }).click();

  // A single profile delete is soft and no longer confirms first (the Undo
  // toast is the safety net — see profileSoftDelete.spec.ts); only the
  // group-delete above still goes through the shared ConfirmDialog.
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(window.locator('td', { hasText: 'E2E Group Profile' })).toHaveCount(0, { timeout: 15_000 });
});

test('multiple selected profiles can be bulk-assigned to a group at once', async () => {
  await window.getByRole('button', { name: 'Manage Groups' }).click();
  const modal = window.locator('.modal-panel');
  await expect(modal).toBeVisible();
  await modal.getByPlaceholder('New group name').fill('E2E Bulk Group');
  await modal.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(modal.locator('text=E2E Bulk Group')).toBeVisible({ timeout: 10_000 });
  await window.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toBeHidden();

  await window.getByPlaceholder('New profile name').fill('E2E Bulk Group Profile A');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  await window.getByPlaceholder('New profile name').fill('E2E Bulk Group Profile B');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const rowA = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Bulk Group Profile A' }) });
  const rowB = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Bulk Group Profile B' }) });
  await expect(rowA).toBeVisible({ timeout: 15_000 });
  await expect(rowB).toBeVisible({ timeout: 15_000 });

  await rowA.locator('input[type="checkbox"]').check();
  await rowB.locator('input[type="checkbox"]').check();

  await window.locator('select').filter({ hasText: 'Move to group…' }).selectOption({ label: 'E2E Bulk Group' });

  // Exact match: "E2E Bulk Group" is also a substring of the profile's own
  // name cell ("E2E Bulk Group Profile A"), which a plain substring hasText
  // filter would match too, tripping Playwright's strict mode.
  await expect(rowA.locator('td', { hasText: /^E2E Bulk Group$/ })).toBeVisible({ timeout: 10_000 });
  await expect(rowB.locator('td', { hasText: /^E2E Bulk Group$/ })).toBeVisible({ timeout: 10_000 });

  // Group filter now shows both, proving the bulk assignment actually
  // persisted server-side rather than just updating local row state.
  await window.locator('select').filter({ hasText: 'All groups' }).selectOption({ label: 'E2E Bulk Group (2)' });
  await expect(window.locator('td', { hasText: 'E2E Bulk Group Profile A' })).toBeVisible();
  await expect(window.locator('td', { hasText: 'E2E Bulk Group Profile B' })).toBeVisible();
  await window.locator('select').filter({ hasText: 'All groups' }).selectOption({ label: 'All groups' });
});
