import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Separate from profileLifecycle.spec.ts because this test actually spawns a
 * second, independent Electron/Chromium OS process (see ARCHITECTURE.md) for
 * the profile being started — slower and more environment-sensitive than the
 * CRUD-only suite, so it's kept isolated and given a longer timeout rather
 * than risking flakiness in the main suite.
 */
test.setTimeout(90_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-browser-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

test('starting a profile launches a real per-profile browser process and stopping it tears it down', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Browser Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Browser Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();

  // Starting spawns a real second Electron/Chromium OS process — give it real time.
  await expect(row).toContainText('RUNNING', { timeout: 30_000 });

  const profileDataDir = fs.readdirSync(userDataDir).find((f) => f === 'profiles');
  expect(profileDataDir).toBeTruthy();
  const profileDirs = fs.readdirSync(path.join(userDataDir, 'profiles'));
  expect(profileDirs.length).toBeGreaterThan(0);
  const browserDataDir = path.join(userDataDir, 'profiles', profileDirs[0]!, 'browser-data');
  // The per-profile child process sets this as its own Electron userData dir;
  // Chromium creates "Local State" there once the process is actually up.
  await expect
    .poll(() => fs.existsSync(browserDataDir), { timeout: 20_000 })
    .toBe(true);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toContainText('STOPPED', { timeout: 30_000 });
});
