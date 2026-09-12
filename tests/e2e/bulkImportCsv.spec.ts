import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let importFilePath: string;

/**
 * `PF_E2E_BULK_IMPORT_FILE` (see bulkCsvImportService.ts's own comment on
 * `parseFromDialog()`) points at one fixed path for the whole app lifetime —
 * a real native `dialog.showOpenDialog` can't be driven by Playwright, so
 * this env var substitutes for "the user picked this file" every time the
 * wizard's "Choose file…" button is clicked. Each test overwrites this same
 * path's *content* right before driving the wizard, so one Electron launch
 * covers every scenario without needing a fresh process per test.
 */
test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-bulk-import-'));
  const importDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-bulk-import-file-'));
  importFilePath = path.join(importDir, 'import.csv');
  fs.writeFileSync(importFilePath, 'name\nplaceholder\n', 'utf-8');

  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_BULK_IMPORT_FILE: importFilePath },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(path.dirname(importFilePath), { recursive: true, force: true });
});

test('a well-formed CSV creates every row as a real profile, with groups/proxy/tags applied', async () => {
  const proxyName = `E2E Bulk Proxy ${Date.now()}`;
  await window.getByText('Proxies', { exact: true }).click();
  await window.getByPlaceholder('Name', { exact: true }).fill(proxyName);
  await window.getByPlaceholder('Host').fill('127.0.0.1');
  await window.getByPlaceholder('Port').fill('8080');
  await window.getByRole('button', { name: 'Add Proxy' }).click();
  await expect(window.locator('tr', { hasText: proxyName })).toBeVisible({ timeout: 10_000 });
  await window.getByText('Profiles', { exact: true }).click();

  fs.writeFileSync(
    importFilePath,
    'name,os,proxy,group,tags\n' +
      `E2E Bulk Alice,windows,${proxyName},E2E Bulk Team,affiliate;warm\n` +
      'E2E Bulk Bob,android,,E2E Bulk Team,\n',
    'utf-8',
  );

  await window.getByRole('button', { name: 'Bulk import (CSV/XLSX)' }).click();
  const modal = window.locator('.modal-panel');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Choose file…' }).click();

  await expect(modal.locator('text=2 valid row(s), 0 invalid row(s)')).toBeVisible({ timeout: 10_000 });
  await expect(modal.getByText('E2E Bulk Alice')).toBeVisible();
  await expect(modal.getByText('E2E Bulk Bob')).toBeVisible();

  await modal.getByRole('button', { name: 'Create 2 profile(s)' }).click();
  await expect(modal.locator('text=Created 2 profile(s)')).toBeVisible({ timeout: 15_000 });
  await window.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(modal).toBeHidden();

  const rowAlice = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Bulk Alice' }) });
  const rowBob = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Bulk Bob' }) });
  await expect(rowAlice).toBeVisible({ timeout: 10_000 });
  await expect(rowBob).toBeVisible();
  // Both rows landed in the group that didn't exist before this import ran —
  // proof the auto-create-group path actually fired, not just that the
  // wizard reported success.
  await expect(rowAlice).toContainText('E2E Bulk Team');
  await expect(rowBob).toContainText('E2E Bulk Team');
});

test('a file mixing valid and invalid rows creates only the valid ones and reports the rest', async () => {
  fs.writeFileSync(
    importFilePath,
    'name,os\n' +
      'E2E Bulk Valid,linux\n' +
      ',macos\n' + // missing name
      'E2E Bulk BadOs,commodore64\n',
    'utf-8',
  );

  await window.getByRole('button', { name: 'Bulk import (CSV/XLSX)' }).click();
  const modal = window.locator('.modal-panel');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Choose file…' }).click();

  await expect(modal.locator('text=1 valid row(s), 2 invalid row(s)')).toBeVisible({ timeout: 10_000 });
  await expect(modal.getByText('Name is required')).toBeVisible();
  await expect(modal.getByText(/Unknown OS "commodore64"/)).toBeVisible();

  await modal.getByRole('button', { name: 'Create 1 profile(s)' }).click();
  await expect(modal.locator('text=Created 1 profile(s)')).toBeVisible({ timeout: 15_000 });
  await expect(modal.locator('text=Skipped 2 row(s):')).toBeVisible();
  await window.getByRole('button', { name: 'Close', exact: true }).click();

  await expect(window.locator('tr', { has: window.locator('td', { hasText: 'E2E Bulk Valid' }) })).toBeVisible({
    timeout: 10_000,
  });
  await expect(window.locator('td', { hasText: 'E2E Bulk BadOs' })).toHaveCount(0);
});

test('a file with no data rows is rejected up front, with nothing created', async () => {
  fs.writeFileSync(importFilePath, 'name,os\n', 'utf-8');

  await window.getByRole('button', { name: 'Bulk import (CSV/XLSX)' }).click();
  const modal = window.locator('.modal-panel');
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Choose file…' }).click();

  await expect(modal.locator('.banner-error')).toContainText(/no data rows to import/, { timeout: 10_000 });
  // Still on the upload step — no preview table, nothing to confirm.
  await expect(modal.getByRole('button', { name: 'Choose file…' })).toBeVisible();
  await window.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(modal).toBeHidden();
});
