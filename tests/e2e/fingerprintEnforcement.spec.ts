import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * The core verification the fingerprint audit demands: does the browser
 * ITSELF actually observe the configured values, not just "does the database
 * say so". PF_E2E_AUTO_DIAGNOSTICS=1 (a testing-only mechanism, never set in
 * a normal launch — see profileWindowEntry.ts) makes the started profile
 * navigate straight to the real diagnostics page instead of the start page;
 * that page's own JS reads the live navigator/screen/Intl/WebGL/RTCPeerConnection
 * state and hands its report back to be written as
 * <profile>/fingerprint-snapshot.json, which this test reads and asserts on.
 *
 * Isolated from the other E2E files for the same reason as
 * profileBrowserLifecycle.spec.ts: it spawns a real second Electron process.
 */
test.setTimeout(90_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-fp-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_AUTO_DIAGNOSTICS: '1', PF_E2E_LOCALE: 'en' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

function readSnapshot(): {
  configured: Record<string, unknown>;
  observed: Record<string, unknown>;
  statusByField: Record<string, string>;
} {
  const profileDirs = fs.readdirSync(path.join(userDataDir, 'profiles'));
  expect(profileDirs.length).toBeGreaterThan(0);
  const snapshotPath = path.join(userDataDir, 'profiles', profileDirs[0]!, 'fingerprint-snapshot.json');
  const raw = fs.readFileSync(snapshotPath, 'utf-8');
  return JSON.parse(raw) as ReturnType<typeof readSnapshot>;
}

test('starting a profile with auto-diagnostics writes a real observed-vs-configured snapshot', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Fingerprint Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Fingerprint Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const snapshotPath = () => {
    const profileDirs = fs.readdirSync(path.join(userDataDir, 'profiles'));
    return path.join(userDataDir, 'profiles', profileDirs[0]!, 'fingerprint-snapshot.json');
  };
  await expect.poll(() => fs.existsSync(snapshotPath()), { timeout: 30_000 }).toBe(true);

  const snapshot = readSnapshot();

  // User-Agent, platform, and languages are enforced via CDP
  // Emulation.setUserAgentOverride — verify the real browser actually
  // reports the configured value, not just that the DB row has it.
  expect(snapshot.statusByField['userAgent']).toBe('PASS');
  expect(snapshot.observed['userAgent']).toBe(snapshot.configured['userAgent']);

  expect(snapshot.statusByField['platform']).toBe('PASS');
  expect(snapshot.observed['platform']).toBe(snapshot.configured['platform']);

  expect(snapshot.statusByField['languages']).toBe('PASS');

  // Timezone is enforced via the TZ environment variable on the per-profile
  // child process — verify Intl actually resolves to the configured zone.
  expect(snapshot.statusByField['timezone']).toBe('PASS');
  expect(snapshot.observed['timezone']).toBe(snapshot.configured['timezone']);

  // Screen dimensions + hardwareConcurrency are enforced via CDP
  // Emulation.setDeviceMetricsOverride / setHardwareConcurrencyOverride.
  expect(snapshot.statusByField['screenWidth']).toBe('PASS');
  expect(snapshot.statusByField['screenHeight']).toBe('PASS');
  expect(snapshot.statusByField['hardwareConcurrency']).toBe('PASS');
  expect(Number(snapshot.observed['hardwareConcurrency'])).toBe(Number(snapshot.configured['hardwareConcurrency']));

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('honestly unenforced properties are reported NOT_IMPLEMENTED, never a false PASS', async () => {
  const snapshot = readSnapshot();

  // deviceMemory: confirmed during the audit that Chromium 128 has no CDP
  // override for it — must never be silently reported as matching.
  expect(snapshot.statusByField['deviceMemory']).toBe('NOT_IMPLEMENTED');

  // WebGL vendor/renderer reflect the real GPU/ANGLE backend; there is no
  // Chromium-native mechanism to force arbitrary configured strings.
  expect(snapshot.statusByField['webglVendor']).toBe('NOT_IMPLEMENTED');
  expect(snapshot.statusByField['webglRenderer']).toBe('NOT_IMPLEMENTED');

  // Canvas/fonts/media-devices have no Chromium-native override mechanism
  // either — the diagnostics page reports the real values, not a fake pass.
  expect(snapshot.statusByField['canvasMode']).toBe('NOT_IMPLEMENTED');
  expect(snapshot.statusByField['fontsMode']).toBe('NOT_IMPLEMENTED');
  expect(snapshot.statusByField['mediaDevicesMode']).toBe('NOT_IMPLEMENTED');
});
