import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * Confirms the "Ad Platform Presets" template group (templateRepository.ts's
 * new ad-* built-ins) is real end to end: the picker actually shows the
 * group next to the existing OS/locale templates, picking one actually
 * drives profile creation through to a genuinely coherent, pinned
 * screen/GPU/hardware fingerprint in the real running browser — not just
 * that the DB row for the template looks right (already covered by
 * templates.test.ts) or that generateFingerprint() alone honors the fields
 * (already covered by fingerprintGenerator.test.ts's preset-coherence
 * tests). Uses the same PF_E2E_AUTO_DIAGNOSTICS + fingerprint-snapshot.json
 * mechanism as mobileFingerprint.spec.ts.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-ad-templates-'));
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

function readSnapshotFor(profilesRoot: string, dirsBefore: Set<string>): { configured: Record<string, unknown> } {
  const newDirs = fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d));
  const dir = newDirs[0]!;
  const snapshotPath = path.join(profilesRoot, dir, 'fingerprint-snapshot.json');
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as { configured: Record<string, unknown> };
}

test('picking "TikTok Ads Mobile" from the toolbar template picker creates a profile with the exact pinned screen/GPU/hardware', async () => {
  const profilesRoot = path.join(userDataDir, 'profiles');
  fs.mkdirSync(profilesRoot, { recursive: true });
  const dirsBefore = new Set(fs.readdirSync(profilesRoot));

  // The toolbar's quick-create template <select> is grouped into "Ad
  // Platform Presets" and "OS / Locale" <optgroup>s (see
  // ProfilesToolbar.tsx) — located by its own option text rather than an
  // accessible name, since it's one of several plain <select> elements in
  // the toolbar with no unique surrounding <label>.
  const templateSelect = window.locator('select').filter({ has: window.locator('option', { hasText: 'TikTok Ads Mobile' }) });
  await expect(templateSelect).toBeVisible();
  // Real proof the grouping rendered, not just that the option exists.
  await expect(templateSelect.locator('optgroup[label="Ad Platform Presets"]')).toBeAttached();
  await expect(templateSelect.locator('optgroup[label="OS / Locale"] option', { hasText: 'Windows Desktop' })).toBeAttached();

  await templateSelect.selectOption({ label: 'TikTok Ads Mobile' });
  await window.getByPlaceholder('New profile name').fill('E2E TikTok Preset Profile');
  await window.getByRole('button', { name: 'New Profile', exact: true }).click();

  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E TikTok Preset Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('android');

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
  await expect.poll(() => fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d)).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const snapshotPath = () => {
    const dir = fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d))[0]!;
    return path.join(profilesRoot, dir, 'fingerprint-snapshot.json');
  };
  await expect.poll(() => fs.existsSync(snapshotPath()), { timeout: 30_000 }).toBe(true);

  const snapshot = readSnapshotFor(profilesRoot, dirsBefore);
  expect(snapshot.configured['screenWidth']).toBe(412);
  expect(snapshot.configured['screenHeight']).toBe(915);
  expect(snapshot.configured['hardwareConcurrency']).toBe(8);
  expect(snapshot.configured['deviceMemory']).toBe(8);
  expect(snapshot.configured['webglVendor']).toBe('Google Inc. (Qualcomm)');
  expect(snapshot.configured['webglRenderer']).toBe('ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)');

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
