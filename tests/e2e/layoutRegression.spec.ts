import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Regression coverage for a real bug that shipped once already: the Settings
 * page's content was pinned flush left with empty space on the right,
 * because the only rule capping its width (`.settings-content`) never
 * actually centered it (see global.css's own comment on that class for the
 * full root-cause history). That was caught by eyeballing a screenshot, not
 * by any test — this spec asserts the actual computed CSS instead, so the
 * same class of bug (a layout container silently losing its centering,
 * width cap, or display mode) fails a real test next time instead of
 * needing another manual screenshot review.
 */

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-layout-'));
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

test('Settings page content is centered with a capped max-width, not flush left', async () => {
  await window.getByText('Settings', { exact: true }).click();
  const content = window.locator('.settings-content');
  await expect(content).toBeVisible();

  await expect(content).toHaveCSS('max-width', '640px');
  // "Centered" means equal left/right margins, both non-zero on a window
  // wider than 640px — a bare max-width without margin:auto (the actual
  // historical bug) leaves margin-left at 0px while margin-right absorbs
  // all the slack, which this specifically catches.
  const margins = await content.evaluate((el) => {
    const style = getComputedStyle(el);
    return { left: style.marginLeft, right: style.marginRight };
  });
  expect(margins.left).toBe(margins.right);
  expect(margins.left).not.toBe('0px');
});

test('Profiles/Proxies/Downloads/Logs pages are NOT centered or width-capped (unaffected by Settings-only styling)', async () => {
  for (const label of ['Profiles', 'Proxies', 'Downloads', 'Logs']) {
    await window.getByText(label, { exact: true }).click();
    const content = window.locator('.content');
    await expect(content).toBeVisible();

    // These pages intentionally use plain `.content` (no `.settings-content`
    // modifier) and should stretch full-width, flush left — asserting that
    // stays true guards against a future global `.content` rule change
    // accidentally spreading Settings' centering everywhere.
    const style = await content.evaluate((el) => {
      const s = getComputedStyle(el);
      return { maxWidth: s.maxWidth, marginLeft: s.marginLeft };
    });
    expect(style.maxWidth).toBe('none');
    expect(style.marginLeft).toBe('0px');
  }
});

test('a profile row highlights when keyboard focus lands on one of its buttons, not on mouse hover alone', async () => {
  await window.getByText('Profiles', { exact: true }).click();
  await window.getByPlaceholder('New profile name').fill('Layout Focus Row');
  await window.getByRole('button', { name: 'New Profile', exact: true }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'Layout Focus Row' }) });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const firstCell = row.locator('td').first();

  const unfocusedBackground = await firstCell.evaluate((el) => getComputedStyle(el).backgroundColor);

  // Real keyboard Tab presses, not a programmatic .focus() call — this
  // exercises the actual :has(:focus-visible) selector the same way a real
  // keyboard user would. Clicks the row's checkbox first, then Tab moves
  // focus onward within the same row, not out of it.
  const checkbox = row.locator('input[type="checkbox"]');
  await checkbox.click();
  await window.keyboard.press('Tab');
  const startButton = row.getByRole('button', { name: 'Start', exact: true });
  await expect(startButton).toBeFocused();

  // `td { transition: background ... }` (global.css) means the new
  // background animates in rather than applying instantly — polling
  // (rather than a fixed sleep) waits exactly as long as the real
  // transition takes, no more, no less, and would still fail if the rule
  // never actually applied at all.
  await expect
    .poll(() => firstCell.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgba(124, 179, 66, 0.05)');

  // Tabbing further, off the row's own buttons and onto whatever follows,
  // removes the highlight again — this isn't a permanent "was ever
  // focused" state. (The row's last action button is "Delete".)
  for (let i = 0; i < 8; i++) {
    await window.keyboard.press('Tab');
  }
  await expect(startButton).not.toBeFocused();
  await expect.poll(() => firstCell.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(unfocusedBackground);
});
