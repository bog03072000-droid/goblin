import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Real, end-to-end coverage of the automation API's actual security
 * boundary: a genuine running profile process, its automation proxy really
 * bound to a real port, and real HTTP requests from this test process (a
 * different OS-level actor than the app itself) either rejected or accepted
 * based on the token — not a mocked/unit-level check of the logic in
 * isolation (see tests/unit/automationProxy.test.ts for that).
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

const AUTOMATION_PORT = 19222;

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
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-automation-'));
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

test('enabling automation exposes a token-gated CDP proxy: wrong/missing token rejected, correct token accepted', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Automation Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Automation Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();

  const enableCheckbox = window.getByLabel('Enable automation access');
  await enableCheckbox.check();

  // The port field only renders once automationEnabled is true — set it to
  // a fixed test port and blur to trigger the save (see AdvancedTab.tsx's
  // onBlur handler).
  const portInput = window.getByLabel('Port (127.0.0.1 only)');
  await expect(portInput).toBeVisible({ timeout: 10_000 });
  await portInput.fill(String(AUTOMATION_PORT));
  await portInput.blur();

  const tokenInput = window.locator('.panel', { has: window.locator('h4', { hasText: 'Automation' }) }).locator('input[readonly]');
  await expect(tokenInput).not.toHaveValue('', { timeout: 10_000 });
  const token = await tokenInput.inputValue();
  expect(token.length).toBeGreaterThanOrEqual(64);

  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  // The automation proxy starts asynchronously after the profile process's
  // own 'ready' event — give it a moment to actually bind before hammering
  // it with requests (this is exactly what the real smoke-test / a real
  // automation client would also have to tolerate: a brief window right
  // after "profile is RUNNING" where the port isn't listening yet).
  await window.waitForTimeout(1500);

  const noToken = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version`);
  expect(noToken.status).toBe(401);

  const wrongToken = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version?token=not-the-real-token`);
  expect(wrongToken.status).toBe(401);

  const correctToken = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version?token=${token}`);
  expect(correctToken.status).toBe(200);
  const parsed = JSON.parse(correctToken.body) as { webSocketDebuggerUrl?: string };
  expect(parsed.webSocketDebuggerUrl).toContain(`127.0.0.1:${AUTOMATION_PORT}`);
  expect(parsed.webSocketDebuggerUrl).toContain(`token=${token}`);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
