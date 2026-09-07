import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * Real, end-to-end confirmation that an explicitly-picked Android/iOS
 * profile genuinely behaves like a mobile browser in the real Chromium
 * process — not just that its stored fingerprint row says so. Uses the
 * same PF_E2E_AUTO_DIAGNOSTICS mechanism as fingerprintEnforcement.spec.ts
 * (the diagnostics page's own in-page JS reads live navigator/matchMedia
 * state) — a separate external CDP connection (the same pattern
 * humanInputDriver.spec.ts uses for the automation feature) was tried
 * first and found to read navigator.platform inconsistently with what the
 * page's own script sees; that is a genuine, separate finding about the
 * automation CDP surface, out of scope for verifying the platform bundles
 * themselves, so this uses the already-established, proven-reliable
 * in-page mechanism instead.
 */
test.setTimeout(90_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-mobile-fp-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_AUTO_DIAGNOSTICS: '1', PF_E2E_LOCALE: 'en' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  await rmSyncWithRetry(userDataDir);
});

async function createAndStartMobileProfile(name: string, mobileOs: 'android' | 'ios'): Promise<void> {
  await window.getByPlaceholder('New profile name').fill(name);
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.getByText('fingerprint', { exact: true }).click();
  await window.getByLabel('Operating system').selectOption(mobileOs);
  // Changing OS regenerates the preview asynchronously (a real
  // fingerprint:generate IPC round trip) — wait for real evidence it
  // landed: the live site-preview panel's own User-Agent cell.
  const expectedUaFragment = mobileOs === 'android' ? 'Android' : 'iPhone';
  await expect(window.getByTestId('fp-site-preview').locator('.fp-preview-ua')).toContainText(expectedUaFragment, {
    timeout: 10_000,
  });

  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: name }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
}

function readSnapshotFor(profilesRoot: string, dirsBefore: Set<string>): {
  configured: Record<string, unknown>;
  observed: Record<string, unknown>;
  statusByField: Record<string, string>;
} {
  const newDirs = fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d));
  const dir = newDirs[0]!;
  const snapshotPath = path.join(profilesRoot, dir, 'fingerprint-snapshot.json');
  const raw = fs.readFileSync(snapshotPath, 'utf-8');
  return JSON.parse(raw) as ReturnType<typeof readSnapshotFor>;
}

test('an explicitly-picked Android profile reports real mobile navigator/matchMedia state', async () => {
  const profilesRoot = path.join(userDataDir, 'profiles');
  fs.mkdirSync(profilesRoot, { recursive: true });
  const dirsBefore = new Set(fs.readdirSync(profilesRoot));

  await createAndStartMobileProfile('E2E Android Profile', 'android');

  await expect
    .poll(() => fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const snapshotPath = () => {
    const dir = fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d))[0]!;
    return path.join(profilesRoot, dir, 'fingerprint-snapshot.json');
  };
  await expect.poll(() => fs.existsSync(snapshotPath()), { timeout: 30_000 }).toBe(true);

  const snapshot = readSnapshotFor(profilesRoot, dirsBefore);

  expect(snapshot.statusByField['platform']).toBe('PASS');
  expect(snapshot.observed['platform']).toBe('Linux armv8l');

  expect(snapshot.statusByField['userAgent']).toBe('PASS');
  expect(String(snapshot.observed['userAgent']).toLowerCase()).toContain('android');
  expect(String(snapshot.observed['userAgent']).toLowerCase()).toContain('mobile');

  expect(snapshot.statusByField['maxTouchPoints']).toBe('PASS');
  expect(snapshot.observed['maxTouchPoints']).toBe(5);

  // The real coherence fix this stage made: CDP's own `mobile` flag now
  // follows the profile's OS (fingerprintEnforcement.ts), which is what
  // drives these media queries — previously hardcoded false regardless of
  // OS, a real gap this stage's own coherence check surfaced.
  expect(snapshot.statusByField['mobileMediaQueries']).toBe('PASS');
  expect(snapshot.observed['pointerCoarse']).toBe(true);
  expect(snapshot.observed['hoverNone']).toBe(true);

  // Portrait screen (width < height) — the normal case for a phone,
  // validator.ts no longer warns about this for a mobile OS.
  expect(Number(snapshot.observed['screenWidth'])).toBeLessThan(Number(snapshot.observed['screenHeight']));

  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Android Profile' }) });
  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('an explicitly-picked iOS profile reports real mobile navigator/matchMedia state, and an Apple-referencing WebGL renderer', async () => {
  const profilesRoot = path.join(userDataDir, 'profiles');
  const dirsBefore = new Set(fs.readdirSync(profilesRoot));

  await createAndStartMobileProfile('E2E iOS Profile', 'ios');

  await expect
    .poll(() => fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
  const snapshotPath = () => {
    const dir = fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d))[0]!;
    return path.join(profilesRoot, dir, 'fingerprint-snapshot.json');
  };
  await expect.poll(() => fs.existsSync(snapshotPath()), { timeout: 30_000 }).toBe(true);

  const snapshot = readSnapshotFor(profilesRoot, dirsBefore);

  expect(snapshot.statusByField['platform']).toBe('PASS');
  expect(snapshot.observed['platform']).toBe('iPhone');

  expect(snapshot.statusByField['userAgent']).toBe('PASS');
  expect(String(snapshot.observed['userAgent']).toLowerCase()).toContain('iphone');

  expect(snapshot.statusByField['maxTouchPoints']).toBe('PASS');
  expect(snapshot.observed['maxTouchPoints']).toBe(5);

  expect(snapshot.statusByField['mobileMediaQueries']).toBe('PASS');

  expect(snapshot.statusByField['webglVendor']).toBe('PASS');
  expect(String(snapshot.observed['webglVendor']).toLowerCase()).toContain('apple');
  expect(snapshot.statusByField['webglRenderer']).toBe('PASS');
  expect(String(snapshot.observed['webglRenderer']).toLowerCase()).toContain('apple');

  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E iOS Profile' }) });
  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
