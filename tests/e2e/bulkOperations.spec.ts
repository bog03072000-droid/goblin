import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Covers the new multi-select + bulk action toolbar added for this stage —
 * DOM interaction that a unit test on ProfileManager's bulk* methods cannot
 * exercise (checkbox state, the "N selected" toolbar appearing/disappearing,
 * the tag-input Enter-to-add flow).
 */
let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-bulk-'));
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

test('multi-select and bulk tag + bulk delete work end to end', async () => {
  for (const name of ['Bulk E2E One', 'Bulk E2E Two']) {
    await window.getByPlaceholder('New profile name').fill(name);
    await window.getByRole('button', { name: 'Custom setup' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    await expect(window.locator('td', { hasText: name })).toBeVisible({ timeout: 15_000 });
  }

  const rowOne = window.locator('tr', { has: window.locator('td', { hasText: 'Bulk E2E One' }) });
  const rowTwo = window.locator('tr', { has: window.locator('td', { hasText: 'Bulk E2E Two' }) });
  await rowOne.locator('input[type="checkbox"]').check();
  await rowTwo.locator('input[type="checkbox"]').check();

  const bulkToolbar = window.locator('.bulk-toolbar');
  await expect(window.locator('text=2 selected')).toBeVisible();

  await window.getByPlaceholder('Add tag + Enter').fill('e2e-bulk-tag');
  await window.getByPlaceholder('Add tag + Enter').press('Enter');

  await expect(window.locator('text=/Tag added to 2/')).toBeVisible({ timeout: 10_000 });
  await expect(rowOne.locator('.tag', { hasText: 'e2e-bulk-tag' })).toBeVisible();
  await expect(rowTwo.locator('.tag', { hasText: 'e2e-bulk-tag' })).toBeVisible();

  // Re-select (the tag-add refresh clears selection state client-side is not
  // guaranteed, so select fresh to make the next assertion independent).
  await rowOne.locator('input[type="checkbox"]').check();
  await rowTwo.locator('input[type="checkbox"]').check();
  await bulkToolbar.getByRole('button', { name: 'Delete', exact: true }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(window.locator('td', { hasText: 'Bulk E2E One' })).toHaveCount(0, { timeout: 15_000 });
  await expect(window.locator('td', { hasText: 'Bulk E2E Two' })).toHaveCount(0);
});
