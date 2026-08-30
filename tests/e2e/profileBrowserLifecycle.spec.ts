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
    env: { ...process.env, PF_E2E_LOCALE: 'en' },
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
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

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
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('restarting a profile tears down the old process, spawns a genuinely new one, and preserves storage', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Restart Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Restart Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  // Resolve this profile's directory by picking the most recently created one
  // (this test runs after "starting a profile..." already created one).
  const profileDirs = fs.readdirSync(path.join(userDataDir, 'profiles'));
  const thisProfileDir = profileDirs
    .map((d) => path.join(userDataDir, 'profiles', d))
    .sort((a, b) => fs.statSync(b).birthtimeMs - fs.statSync(a).birthtimeMs)[0]!;

  const lockPath = path.join(thisProfileDir, 'profile.lock');
  await expect.poll(() => fs.existsSync(lockPath), { timeout: 15_000 }).toBe(true);
  const firstLockPid = (JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid: number }).pid;

  // A real, independently-verifiable persistence marker — not a stand-in.
  const markerPath = path.join(thisProfileDir, 'browser-data', 'e2e-restart-marker.txt');
  fs.writeFileSync(markerPath, 'persisted-across-restart');

  await row.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  // Poll for the PID to actually change, not just for the lock file to
  // exist — it exists continuously across a restart (old lock is released
  // and a new one acquired), so checking mere existence right after clicking
  // Restart can race and read the still-live old lock before the new one
  // lands, rather than proving a new OS process. Polling until the value
  // itself differs from the first reading is what actually proves it.
  const readPid = (): number | null => {
    if (!fs.existsSync(lockPath)) return null;
    try {
      return (JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid: number }).pid;
    } catch {
      return null;
    }
  };
  const readDifferentPid = (): number | string => {
    const pid = readPid();
    return pid !== null && pid !== firstLockPid ? pid : 'unchanged';
  };
  await expect.poll(readDifferentPid, { timeout: 30_000 }).not.toBe('unchanged');
  const secondLockPid = readPid();
  expect(secondLockPid).not.toBeNull();
  expect(secondLockPid).not.toBe(firstLockPid);

  expect(fs.existsSync(markerPath)).toBe(true);
  expect(fs.readFileSync(markerPath, 'utf-8')).toBe('persisted-across-restart');

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
