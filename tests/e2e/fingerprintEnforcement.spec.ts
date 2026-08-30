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

// `fs.readdirSync(...)[0]` is NOT guaranteed to be "the first profile
// created" — directory listing order is filesystem-dependent, and once a
// second profile exists (added below for the cross-profile noise test) an
// index-based lookup becomes ambiguous. Each test that creates a profile
// pins down its own directory explicitly instead of guessing from the list.
function readSnapshotFrom(profileDir: string): {
  configured: Record<string, unknown>;
  observed: Record<string, unknown>;
  statusByField: Record<string, string>;
} {
  const snapshotPath = path.join(userDataDir, 'profiles', profileDir, 'fingerprint-snapshot.json');
  const raw = fs.readFileSync(snapshotPath, 'utf-8');
  return JSON.parse(raw) as ReturnType<typeof readSnapshotFrom>;
}

function readSnapshot(): ReturnType<typeof readSnapshotFrom> {
  return readSnapshotFrom(firstProfileDir);
}

let firstProfileDir: string;

test('starting a profile with auto-diagnostics writes a real observed-vs-configured snapshot', async () => {
  const profilesRoot = path.join(userDataDir, 'profiles');
  fs.mkdirSync(profilesRoot, { recursive: true });
  const dirsBefore = new Set(fs.readdirSync(profilesRoot));

  await window.getByPlaceholder('New profile name').fill('E2E Fingerprint Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Fingerprint Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const newDirs = () => fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d));
  await expect.poll(() => newDirs().length, { timeout: 30_000 }).toBeGreaterThan(0);
  firstProfileDir = newDirs()[0]!;

  const snapshotPath = path.join(profilesRoot, firstProfileDir, 'fingerprint-snapshot.json');
  await expect.poll(() => fs.existsSync(snapshotPath), { timeout: 30_000 }).toBe(true);

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

  // deviceMemory is now genuinely applied via the CDP-injected spoofing
  // script (there's still no CDP Emulation method for it — see Finding 3 —
  // this is the JS-override path added for this stage).
  expect(snapshot.statusByField['deviceMemory']).toBe('PASS');
  expect(Number(snapshot.observed['deviceMemory'])).toBe(Number(snapshot.configured['deviceMemory']));

  // Canvas/audio noise default to 'on' for a new profile (generator.ts) —
  // verify the override is actually installed and, critically, that it's
  // *deterministic*: the same canvas content read twice in a row produces
  // byte-identical output, not fresh random noise every call.
  expect(snapshot.statusByField['canvasMode']).toBe('APPLIED');
  expect(snapshot.observed['canvasDeterministic']).toBe(true);
  expect(snapshot.statusByField['audioMode']).toBe('APPLIED');

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('honestly unenforced-by-default properties are reported NOT_IMPLEMENTED, never a false PASS', async () => {
  const snapshot = readSnapshot();

  // WebGL vendor/renderer: off by default (opt-in, see WEBGL_SPOOFING_ENABLED
  // test below) — reflects the real GPU/ANGLE backend until explicitly enabled.
  expect(snapshot.statusByField['webglVendor']).toBe('NOT_IMPLEMENTED');
  expect(snapshot.statusByField['webglRenderer']).toBe('NOT_IMPLEMENTED');

  // Fonts/media-devices default to their non-spoofing mode ('system'/'real')
  // — the diagnostics page reports the real values, not a fake pass.
  expect(snapshot.statusByField['fontsMode']).toBe('NOT_IMPLEMENTED');
  expect(snapshot.statusByField['mediaDevicesMode']).toBe('NOT_IMPLEMENTED');
});

test('canvas noise is profile-specific: two profiles reading identical content get different results', async () => {
  const profilesRoot = path.join(userDataDir, 'profiles');
  const dirsBefore = new Set(fs.readdirSync(profilesRoot));

  await window.getByPlaceholder('New profile name').fill('E2E Fingerprint Profile 2');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Fingerprint Profile 2' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const newDirs = () => fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d));
  await expect.poll(() => newDirs().length, { timeout: 30_000 }).toBeGreaterThan(0);
  const secondProfileDir = newDirs()[0]!;
  const secondSnapshotPath = path.join(profilesRoot, secondProfileDir, 'fingerprint-snapshot.json');
  await expect.poll(() => fs.existsSync(secondSnapshotPath), { timeout: 30_000 }).toBe(true);
  const secondSnapshot = readSnapshotFrom(secondProfileDir);
  const firstSnapshot = readSnapshot();

  expect(firstSnapshot.configured['seed']).not.toBe(secondSnapshot.configured['seed']);
  // Same drawn content ("pf-diag" in 14px Arial on a 50x50 canvas — identical
  // on every profile), but the noise is seeded per-profile, so the resulting
  // bytes differ between the two profiles despite the identical input.
  expect(firstSnapshot.observed['canvasFingerprintTail']).not.toBe(secondSnapshot.observed['canvasFingerprintTail']);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
