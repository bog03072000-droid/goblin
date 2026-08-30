import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Covers the daily-use polish pass on the Profiles page: richer profile
 * creation, filter-by-proxy, invert selection, sort direction, bulk
 * restart/backup, the right-click context menu, page-level keyboard
 * shortcuts, and the editor's unsaved-changes warning. Deliberately CRUD-only
 * (like profileLifecycle.spec.ts) — none of this needs a real per-profile
 * browser process, so it stays fast and avoids that flakiness class entirely.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-polish-'));
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

test('creating a profile with group/proxy/tags set inline applies them immediately, no separate edit step needed', async () => {
  await window.getByText('Proxies', { exact: true }).click();
  await window.getByPlaceholder('Name', { exact: true }).fill('Polish Proxy');
  await window.getByPlaceholder('Host').fill('127.0.0.1');
  await window.getByPlaceholder('Port').fill('8081');
  await window.getByRole('button', { name: 'Add Proxy' }).click();
  await expect(window.locator('td', { hasText: 'Polish Proxy' })).toBeVisible({ timeout: 10_000 });
  await window.getByText('Profiles', { exact: true }).click();

  await window.getByRole('button', { name: '+ Manage Groups' }).click();
  const groupModal = window.locator('.modal-panel');
  await groupModal.getByPlaceholder('New group name').fill('Polish Group');
  await groupModal.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(groupModal.locator('text=Polish Group')).toBeVisible({ timeout: 10_000 });
  await window.getByRole('button', { name: 'Close', exact: true }).click();

  await window.getByPlaceholder('New profile name').fill('Fully Configured Profile');
  await window.locator('select[title="Move to group…"]').selectOption({ label: 'Polish Group' });
  await window.locator('select[title="Proxy"]').selectOption({ label: 'Polish Proxy' });
  await window.getByPlaceholder('Tags (comma-separated)').fill('vip, fresh');
  await window.getByRole('button', { name: 'New Profile' }).click();

  const row = window.locator('tr', { has: window.locator('td', { hasText: 'Fully Configured Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('td', { hasText: 'Polish Group' })).toBeVisible();
  await expect(row.locator('td', { hasText: 'Polish Proxy' })).toBeVisible();
  await expect(row.locator('.tag', { hasText: 'vip' })).toBeVisible();
  await expect(row.locator('.tag', { hasText: 'fresh' })).toBeVisible();
});

test('filter by proxy narrows the list to only profiles using that proxy', async () => {
  await window.getByPlaceholder('New profile name').fill('No Proxy Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await expect(window.locator('td', { hasText: 'No Proxy Profile' })).toBeVisible({ timeout: 15_000 });

  const proxyFilter = window.locator('select').filter({ hasText: 'All proxies' });
  await proxyFilter.selectOption({ label: 'Polish Proxy' });
  await expect(window.locator('td', { hasText: 'Fully Configured Profile' })).toBeVisible();
  await expect(window.locator('td', { hasText: 'No Proxy Profile' })).toHaveCount(0);

  await proxyFilter.selectOption({ label: 'No proxy' });
  await expect(window.locator('td', { hasText: 'No Proxy Profile' })).toBeVisible();
  await expect(window.locator('td', { hasText: 'Fully Configured Profile' })).toHaveCount(0);

  await proxyFilter.selectOption({ label: 'All proxies' });
  await expect(window.locator('td', { hasText: 'Fully Configured Profile' })).toBeVisible();
  await expect(window.locator('td', { hasText: 'No Proxy Profile' })).toBeVisible();
});

test('sort direction toggle actually reverses the visible order', async () => {
  const nameCells = () => window.locator('td').filter({ hasText: /Profile$/ });
  const sortSelect = window.locator('select').filter({ hasText: 'Sort: Name' });
  await sortSelect.selectOption('name');

  const firstAsc = await nameCells().first().textContent();
  const dirButton = window.locator('button', { hasText: '↑' }).or(window.locator('button', { hasText: '↓' }));
  await dirButton.click();
  const firstDesc = await nameCells().first().textContent();
  expect(firstAsc).not.toBe(firstDesc);
});

test('invert selection selects exactly the complement of the current selection', async () => {
  const rows = window.locator('tbody tr');
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);

  await rows.nth(0).locator('input[type="checkbox"]').check();
  await expect(window.locator('.bulk-toolbar')).toBeVisible();
  await expect(window.getByText('1 selected')).toBeVisible();

  await window.getByRole('button', { name: 'Invert selection' }).click();
  await expect(window.getByText(`${count - 1} selected`)).toBeVisible();
  await expect(rows.nth(0).locator('input[type="checkbox"]')).not.toBeChecked();
  await expect(rows.nth(1).locator('input[type="checkbox"]')).toBeChecked();

  await window.getByRole('button', { name: 'Clear selection' }).click();
});

test('bulk Backup is available and reports a completion summary', async () => {
  // Restart is deliberately not exercised here — it spawns a real per-profile
  // OS process, which this file's whole design avoids (see the module doc
  // comment); bulkRestart already has dedicated unit coverage in
  // tests/unit/bulkOperations.test.ts.
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'No Proxy Profile' }) });
  await row.locator('input[type="checkbox"]').check();
  await expect(window.locator('.bulk-toolbar')).toBeVisible();

  // Scoped to the bulk toolbar specifically — every row also has its own
  // per-profile "Backup" button, so an unscoped lookup is ambiguous once
  // more than one profile row exists on the page.
  await window.locator('.bulk-toolbar').getByRole('button', { name: 'Backup', exact: true }).click();
  await expect(window.locator('.banner-success', { hasText: /succeeded/ })).toBeVisible({ timeout: 15_000 });

  await row.locator('input[type="checkbox"]').uncheck();
});

test('right-click opens a context menu with state-appropriate actions, and Edit opens the editor', async () => {
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'No Proxy Profile' }) });
  await row.click({ button: 'right' });
  const menu = window.locator('.context-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByText('Open', { exact: true })).toBeVisible();
  await expect(menu.getByText('Stop', { exact: true })).toHaveCount(0); // not running
  await expect(menu.getByText('Delete', { exact: true })).toBeVisible();

  await menu.getByText('Edit', { exact: true }).click();
  await expect(window.locator('.modal-panel')).toBeVisible({ timeout: 10_000 });
  await window.getByRole('button', { name: 'Close' }).click();
});

test('closing the editor with unsaved changes asks for confirmation before discarding', async () => {
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'No Proxy Profile' }) });
  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('.modal-panel')).toBeVisible({ timeout: 10_000 });

  await window.getByLabel('Description').fill('An unsaved edit');
  await window.getByRole('button', { name: 'Close' }).click();

  // A second confirmation dialog stacks on top — cancelling it keeps the editor open.
  const confirmDialogs = window.locator('.modal-panel');
  await expect(confirmDialogs.last()).toContainText('unsaved changes', { timeout: 5_000 });
  await window.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(window.getByLabel('Description')).toHaveValue('An unsaved edit');

  // Confirming discards the edit and actually closes.
  await window.getByRole('button', { name: 'Close' }).click();
  await window.getByRole('button', { name: 'Discard changes' }).click();
  await expect(window.locator('.modal-panel')).toHaveCount(0);
});

test('keyboard shortcuts: Ctrl+F focuses search, Ctrl+N focuses create name, Ctrl+A selects all, Delete opens bulk-delete confirm', async () => {
  await window.keyboard.press('Control+f');
  await expect(window.locator('#profiles-search-input')).toBeFocused();

  await window.keyboard.press('Control+n');
  await expect(window.locator('#profiles-create-name-input')).toBeFocused();

  // Explicitly blur out of the input before Ctrl+A, since that shortcut is
  // deliberately suppressed while typing (so it doesn't fight normal text
  // selection inside a field) — a plain click on empty space doesn't
  // reliably move focus off an input in every environment.
  await window.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await window.keyboard.press('Control+a');
  await expect(window.locator('.bulk-toolbar')).toBeVisible({ timeout: 5_000 });

  await window.keyboard.press('Delete');
  await expect(window.locator('.modal-panel')).toContainText('selected profile', { timeout: 5_000 });
  await window.getByRole('button', { name: 'Cancel', exact: true }).click();
  await window.getByRole('button', { name: 'Clear selection' }).click();
});
