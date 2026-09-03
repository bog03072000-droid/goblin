import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Full-cycle E2E coverage for soft-delete + Undo (see profileManager.ts's
 * SOFT_DELETE_WINDOW_MS and ProfilesPage.tsx's UndoToast wiring). Unit-level
 * coverage of the timeout/undo logic itself lives in
 * tests/unit/profileSoftDelete.test.ts — this file only exercises the real
 * UI path: click Delete, see the toast, click Undo, profile is back; and,
 * separately, that letting the window expire really does remove it.
 *
 * PF_SOFT_DELETE_WINDOW_MS is set very small here so "let it expire" doesn't
 * mean a real 30s wait — this is a test-only override (see the PF_E2E_*
 * convention documented across this test suite).
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-softdelete-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_SOFT_DELETE_WINDOW_MS: '3000' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

async function createProfile(name: string): Promise<void> {
  await window.getByText('Profiles', { exact: true }).click();
  await window.getByPlaceholder('New profile name').fill(name);
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  await expect(window.locator('td', { hasText: name })).toBeVisible({ timeout: 10_000 });
}

test('delete -> Undo brings the profile back, no confirmation dialog needed for a single delete', async () => {
  await createProfile('Undo Me');
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'Undo Me' }) });

  await row.getByRole('button', { name: 'Delete', exact: true }).click();

  // No ConfirmDialog for a single delete anymore (see ProfilesPage.tsx) —
  // the row disappears immediately and the Undo toast appears instead.
  await expect(window.locator('.modal-panel')).toHaveCount(0);
  await expect(row).toHaveCount(0);
  const toast = window.locator('.undo-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Undo Me');

  await toast.getByRole('button', { name: 'Undo' }).click();

  await expect(window.locator('.undo-toast')).toHaveCount(0);
  await expect(window.locator('tr', { has: window.locator('td', { hasText: 'Undo Me' }) })).toBeVisible({
    timeout: 10_000,
  });
});

test('letting the undo window expire permanently removes the profile', async () => {
  await createProfile('Expire Me');
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'Expire Me' }) });

  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(window.locator('.undo-toast')).toBeVisible();

  // Don't touch Undo — let PF_SOFT_DELETE_WINDOW_MS (3s, set in beforeAll)
  // elapse for real, then confirm the profile stays gone after a fresh list
  // refresh (switching pages forces one).
  await window.waitForTimeout(4_000);
  await window.getByText('Proxies', { exact: true }).click();
  await window.getByText('Profiles', { exact: true }).click();

  await expect(window.locator('tr', { has: window.locator('td', { hasText: 'Expire Me' }) })).toHaveCount(0);
});

test('bulk delete still confirms first, and its own Undo restores every deleted profile', async () => {
  await createProfile('Bulk Undo A');
  await createProfile('Bulk Undo B');

  const rowA = window.locator('tr', { has: window.locator('td', { hasText: 'Bulk Undo A' }) });
  const rowB = window.locator('tr', { has: window.locator('td', { hasText: 'Bulk Undo B' }) });
  await rowA.locator('input[type="checkbox"]').check();
  await rowB.locator('input[type="checkbox"]').check();

  await window.locator('.bulk-toolbar').getByRole('button', { name: 'Delete', exact: true }).click();
  const confirmDialog = window.locator('.modal-panel');
  await expect(confirmDialog).toContainText('selected profile', { timeout: 5_000 });
  await confirmDialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(rowA).toHaveCount(0);
  await expect(rowB).toHaveCount(0);
  const toast = window.locator('.undo-toast');
  await expect(toast).toBeVisible();

  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(window.locator('tr', { has: window.locator('td', { hasText: 'Bulk Undo A' }) })).toBeVisible({
    timeout: 10_000,
  });
  await expect(window.locator('tr', { has: window.locator('td', { hasText: 'Bulk Undo B' }) })).toBeVisible();
});
