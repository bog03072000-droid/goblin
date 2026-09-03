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

test('theme defaults to system (no [data-theme] attribute); explicit Light/Dark genuinely repaint the page (not just the attribute) and the choice persists across restart', async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-theme-'));

  let app: ElectronApplication = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en' },
  });
  let window: Page = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // 'system' sets no attribute at all — whatever color that resolves to
  // depends on this machine's own OS preference, which the test can't
  // assume either way, so the real assertions below compare Light vs. Dark
  // against each other and against global.css's own known literal values,
  // never against an assumed "system" baseline.
  await expect(window.locator('html')).not.toHaveAttribute('data-theme', /.+/);

  await window.locator('.sidebar-item', { hasText: 'Settings' }).click();
  const themeSelect = window.locator('select').filter({ has: window.locator('option[value="light"]') });

  await themeSelect.selectOption('dark');
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkBg = await window.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBg).toBe('rgb(18, 20, 18)'); // #121412 — global.css's :root[data-theme="dark"] --bg

  await themeSelect.selectOption('light');
  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light');
  // Not just the attribute — the actual rendered background must genuinely
  // differ from the dark one just measured, proving the CSS variable
  // override is real and not an inert marker attribute nothing reacts to.
  await expect
    .poll(() => window.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe('rgb(246, 248, 243)'); // #f6f8f3 — global.css's :root[data-theme="light"] --bg
  const lightBg = await window.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(lightBg).not.toBe(darkBg);

  await app.close();

  // Real second launch — not a reload — to prove the choice was actually
  // persisted to disk, not just held in React state.
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  await expect(window.locator('html')).toHaveAttribute('data-theme', 'light', { timeout: 15_000 });

  await app.close();
});
