import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * LogsPage rows previously had zero focusable/clickable elements at all —
 * nothing for :has(:focus-visible) (global.css) to attach to, and no way to
 * see a long message except however much a plain <td> happened to wrap. A
 * dedicated app instance rather than reusing layoutRegression.spec.ts's
 * shared one, so exactly one log entry (this test's own profile creation)
 * exists — no ambiguity about which row's toggle is "the first one".
 */
let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-logs-expand-'));
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

test('a log message expands on click, and its row highlights on real keyboard focus', async () => {
  // A real, distinctive activity-log entry: creating a profile logs
  // PROFILE_CREATED with the profile's name in the message — the name is
  // deliberately long enough that `Profile "<name>" created` clears
  // LogsPage's own 80-char expand threshold (item 3's conditional toggle),
  // since a short message would render no toggle at all to test here.
  const profileName = 'Logs Expand Target Extra Long Name For Threshold Testing Purposes';
  await window.getByPlaceholder('New profile name').fill(profileName);
  await window.getByRole('button', { name: 'New Profile', exact: true }).click();
  await expect(window.locator('td', { hasText: profileName })).toBeVisible({ timeout: 10_000 });

  await window.getByText('Logs', { exact: true }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: profileName }) });
  await expect(row).toBeVisible({ timeout: 10_000 });
  const toggle = row.locator('.log-message-toggle');
  await expect(toggle).toBeVisible();
  const firstCell = row.locator('td').first();
  // Captured before any interaction with the row — a background reading
  // taken after clicking the toggle could still carry a residual
  // `tr:hover` tint from the mouse resting over it, not a true "cold" value.
  const unfocusedBackground = await firstCell.evaluate((el) => getComputedStyle(el).backgroundColor);

  // Collapsed by default: the message cell truncates, not the full-width
  // expanded style.
  expect(await toggle.locator('.log-message-expanded').count()).toBe(0);

  await toggle.click();
  await expect(toggle.locator('.log-message-expanded')).toBeVisible();
  await expect(toggle).toHaveAttribute('title', 'Show less');

  await toggle.click();
  await expect(toggle.locator('.log-message-expanded')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('title', 'Show full message');

  // Real keyboard focus (not `.focus()`) reaching the toggle should
  // highlight its row, the same global tr:has(:focus-visible) rule
  // ProfilesTable/ProxiesPage rows already get — this row previously had
  // nothing at all for that selector to match.
  await toggle.click(); // mouse-focus first, not :focus-visible
  await window.keyboard.press('Shift+Tab');
  await window.keyboard.press('Tab'); // back onto the same toggle, via keyboard this time
  await expect(toggle).toBeFocused();

  await expect
    .poll(() => firstCell.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe('rgba(124, 179, 66, 0.05)');

  await window.getByText('Profiles', { exact: true }).click();
  await window.getByText('Logs', { exact: true }).click();
  await expect.poll(() => firstCell.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(unfocusedBackground);
});
