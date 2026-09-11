import { test, expect, _electron as electron, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/** Reads a `background-color` only once it's stopped changing — `td {
 * transition: background ... }` (global.css) means a read taken right
 * after a class/focus change can land mid-animation instead of on the
 * settled value. Two consecutive equal reads, ~40ms apart, is the actual
 * signal the transition finished; a fixed timeout guess is either too
 * short (flaky) or wastes time padding every call with worst-case slack. */
async function readStableBackground(locator: Locator): Promise<string> {
  let previous = await locator.evaluate((el) => getComputedStyle(el).backgroundColor);
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 40));
    const current = await locator.evaluate((el) => getComputedStyle(el).backgroundColor);
    if (current === previous) return current;
    previous = current;
  }
  return previous;
}

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

  // Real keyboard Tab presses, not a programmatic .focus() call — this
  // exercises the actual :has(:focus-visible) selector the same way a real
  // keyboard user would. Clicks the row's checkbox first, then Tab moves
  // focus onward within the same row, not out of it.
  const checkbox = row.locator('input[type="checkbox"]');
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  // Captured AFTER selecting (not before): a selected row now carries its
  // own lime-wash background (see ProfilesTable.tsx's row-selected class),
  // so "unfocused" here means "selected but not focused", the actual state
  // this test returns to once focus moves off the row again below.
  // `td { transition: background ... }` (global.css) means a plain read
  // right after the click can land mid-animation rather than on the
  // settled value — waiting for two consecutive reads to agree (rather
  // than a fixed timeout guess) is what actually makes this robust.
  const unfocusedBackground = await readStableBackground(firstCell);
  await window.keyboard.press('Tab');
  const startButton = row.getByRole('button', { name: 'Start', exact: true });
  await expect(startButton).toBeFocused();

  // `td { transition: background ... }` (global.css) means the new
  // background animates in rather than applying instantly — polling
  // (rather than a fixed sleep) waits exactly as long as the real
  // transition takes, no more, no less, and would still fail if the rule
  // never actually applied at all.
  // A neutral surface step (--char-raised), not a lime tint — the design
  // system's own "accent discipline" rule reserves lime for one moment per
  // view (the selected-row wash, the primary button, ...), not every
  // focused/hovered row too. Asserted as "differs from the unfocused
  // background" rather than a hardcoded RGB literal, since --char-raised
  // resolves differently in light vs. dark theme (whichever this test
  // machine's OS preference picks) — unlike the old rule this replaced,
  // which was a theme-invariant hardcoded rgba() literal.
  await expect
    .poll(() => firstCell.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(unfocusedBackground);

  // Tabbing further, off the row's own buttons and onto whatever follows,
  // removes the highlight again — this isn't a permanent "was ever
  // focused" state. (The row's last action button is "Delete".)
  for (let i = 0; i < 8; i++) {
    await window.keyboard.press('Tab');
  }
  await expect(startButton).not.toBeFocused();
  expect(await readStableBackground(firstCell)).toBe(unfocusedBackground);
});

test('a proxy row highlights on keyboard focus too, proving :has(:focus-visible) is a global rule, not ProfilesTable-specific', async () => {
  await window.getByText('Proxies', { exact: true }).click();
  await window.getByPlaceholder('Name', { exact: true }).fill('Layout Focus Proxy');
  await window.getByPlaceholder('Host').fill('127.0.0.1');
  await window.getByPlaceholder('Port').fill('8811');
  await window.getByRole('button', { name: 'Add Proxy' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'Layout Focus Proxy' }) });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const firstCell = row.locator('td').first();

  const unfocusedBackground = await firstCell.evaluate((el) => getComputedStyle(el).backgroundColor);

  // `:focus-visible` is a browser heuristic tied to a real keyboard-driven
  // focus change (same reason the ProfilesTable test above uses real Tab
  // presses, not `.focus()`) — ProxiesPage rows have no checkbox to click
  // first, so instead mouse-click the "Test" button (a real click's own
  // resulting focus is NOT :focus-visible) then Tab onto the next button,
  // which IS a keyboard-driven focus change.
  const testButton = row.getByRole('button', { name: 'Test', exact: true });
  await testButton.click();
  await window.keyboard.press('Tab');
  const historyButton = row.getByRole('button', { name: /History/, exact: false });
  await expect(historyButton).toBeFocused();

  // A neutral surface step (--char-raised), not a lime tint — the design
  // system's own "accent discipline" rule reserves lime for one moment per
  // view (the selected-row wash, the primary button, ...), not every
  // focused/hovered row too. Asserted as "differs from the unfocused
  // background" rather than a hardcoded RGB literal, since --char-raised
  // resolves differently in light vs. dark theme (whichever this test
  // machine's OS preference picks) — unlike the old rule this replaced,
  // which was a theme-invariant hardcoded rgba() literal.
  await expect
    .poll(() => firstCell.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(unfocusedBackground);

  // Moving focus off the row entirely (a plain click on non-interactive
  // page text) removes the highlight again — this isn't a permanent
  // "was ever focused" state.
  await window.getByText('Proxies', { exact: true }).click();
  await expect(historyButton).not.toBeFocused();
  await expect.poll(() => firstCell.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(unfocusedBackground);
});

test('a data table panel scrolls its own overflow on a narrow window instead of the whole page scrolling sideways', async () => {
  // Found missing while checking LogsPage.tsx's .log-message-toggle
  // (width: 100%) at narrow widths: no table's .panel wrapper had
  // overflow-x set at all, so the *page* itself scrolled sideways past a
  // certain width instead of the panel containing its own table — the
  // toggle button itself was never the problem, the missing overflow
  // container was.
  await window.setViewportSize({ width: 700, height: 800 });
  try {
    await window.getByText('Logs', { exact: true }).click();
    await expect
      .poll(() => window.evaluate(() => document.body.scrollWidth === document.body.clientWidth))
      .toBe(true);

    const panel = window.locator('.panel').first();
    await expect(panel).toHaveCSS('overflow-x', 'auto');
    const panelOverflows = await panel.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(panelOverflows).toBe(true);
  } finally {
    // Reset for any test that runs after this one in the same shared window.
    await window.setViewportSize({ width: 1400, height: 900 });
  }
});
