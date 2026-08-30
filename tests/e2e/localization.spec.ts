import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Deliberately does NOT set PF_E2E_LOCALE (unlike every other E2E spec) —
 * this is the one test that must exercise the real default, unforced
 * behavior: Ukrainian on first launch, a working language switch, and that
 * switch surviving an application restart against the same profile data
 * (a real second `electron.launch`, not a page reload).
 */
let userDataDir: string;

test.afterEach(() => {
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('Ukrainian is the default language on first launch', async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-i18n-'));
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`] });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect(window.locator('.sidebar-item', { hasText: 'Профілі' })).toBeVisible({ timeout: 15_000 });
  await expect(window.locator('.sidebar-item', { hasText: 'Налаштування' })).toBeVisible();

  await app.close();
});

test('switching to English updates the UI immediately, and the choice survives an app restart', async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-i18n-switch-'));

  let app: ElectronApplication = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
  });
  let window: Page = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // Ukrainian by default.
  await expect(window.locator('.sidebar-item', { hasText: 'Профілі' })).toBeVisible({ timeout: 15_000 });

  await window.locator('.sidebar-item', { hasText: 'Налаштування' }).click();
  await window.locator('select').first().selectOption('en');

  // UI switches immediately, without a reload.
  await expect(window.locator('.sidebar-item', { hasText: 'Profiles' })).toBeVisible({ timeout: 5_000 });
  await expect(window.locator('.sidebar-item', { hasText: 'Профілі' })).toHaveCount(0);

  await app.close();

  // Real second launch against the same userData — not a page reload — to
  // prove the choice was actually persisted to disk, not just in memory.
  app = await electron.launch({ args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`] });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect(window.locator('.sidebar-item', { hasText: 'Profiles' })).toBeVisible({ timeout: 15_000 });
  await expect(window.locator('.sidebar-item', { hasText: 'Профілі' })).toHaveCount(0);

  await app.close();
});
