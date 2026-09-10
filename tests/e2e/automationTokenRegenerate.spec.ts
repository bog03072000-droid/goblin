import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Real edge case from this round's list: "automation API token regenerate
 * during an active client connection". The UI's own copy
 * (editor.advanced.automation.regenerateHint) makes an explicit claim:
 * "Generates a new token and invalidates the old one immediately." —
 * checked against the real, running app rather than trusted at face value.
 *
 * `startAutomationProxy()` captures its `token` as a closure variable at
 * profile-process launch time (profileWindowEntry.ts reads it once from
 * `credentials.automationToken`) — there is no live channel telling an
 * already-running profile's automation proxy that the token stored in the
 * database changed. `regenerateAutomationToken()` (profileRepository.ts)
 * only ever writes to the DB.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

const AUTOMATION_PORT = 19230;

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
  });
}

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-token-regen-'));
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

test('regenerating the automation token while the profile is RUNNING does not actually invalidate the old one, contradicting the UI\'s own "immediately" claim', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Token Regen Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Token Regen Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();
  await window.getByLabel('Enable automation access').check();
  const portInput = window.getByLabel('Port (127.0.0.1 only)');
  await expect(portInput).toBeVisible({ timeout: 10_000 });
  await portInput.fill(String(AUTOMATION_PORT));
  await portInput.blur();

  const tokenInput = window.locator('.panel', { has: window.locator('h4', { hasText: 'Automation' }) }).locator('input[readonly]');
  await expect(tokenInput).not.toHaveValue('', { timeout: 10_000 });
  const oldToken = await tokenInput.inputValue();
  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
  await window.waitForTimeout(1500);

  // Confirm the old token genuinely works against the live, running proxy
  // before regenerating anything.
  const beforeRegen = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version?token=${oldToken}`);
  expect(beforeRegen.status).toBe(200);

  // Regenerate WHILE the profile is still running — the exact scenario a
  // user reacting to a leaked token would be in.
  await row.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('advanced', { exact: true }).click();
  await window.getByRole('button', { name: 'Regenerate' }).click();
  const newToken = await tokenInput.inputValue();
  expect(newToken).not.toBe(oldToken);
  await window.getByRole('button', { name: 'Close' }).click();

  // The real, live proxy is still checking against the OLD token — proves
  // the UI's "invalidates the old one immediately" claim is false for a
  // profile that's already running.
  const oldTokenAfterRegen = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version?token=${oldToken}`);
  expect(oldTokenAfterRegen.status).toBe(200);

  // The flip side of the same gap: the NEW token the UI now displays
  // (and that a user would naturally copy next) does NOT work against
  // this still-running profile either, since the live proxy never learned
  // about it — a genuinely confusing symptom on top of the security one.
  const newTokenAfterRegen = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version?token=${newToken}`);
  expect(newTokenAfterRegen.status).toBe(401);

  // Restarting the profile picks up the new token from the DB (a fresh
  // process launch re-reads it) — confirms the gap is specifically "no
  // live update to a running process", not that the new token is broken.
  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
  await window.waitForTimeout(1500);

  const newTokenAfterRestart = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version?token=${newToken}`);
  expect(newTokenAfterRestart.status).toBe(200);
  const oldTokenAfterRestart = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version?token=${oldToken}`);
  expect(oldTokenAfterRestart.status).toBe(401);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
