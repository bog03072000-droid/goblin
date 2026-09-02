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
