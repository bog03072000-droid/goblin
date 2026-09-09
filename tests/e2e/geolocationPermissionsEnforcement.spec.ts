import { test, expect, _electron as electron, chromium, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * Permissions/geolocation enforcement (`applyPermissionPolicy`, the
 * `Emulation.setGeolocationOverride` call in fingerprintEnforcement.ts) has
 * existed since commit ccda7ca (2026-09-03) with real schema fields, real
 * UI, and real CDP/session wiring — but docs/FINGERPRINT_AUDIT.md still
 * graded both **D** ("not implemented... not represented in the fingerprint
 * data model at all"), and no E2E test anywhere in this project ever drove
 * a real profile against `navigator.geolocation`/`navigator.permissions` to
 * confirm the mechanism actually takes effect in a live browser. Same class
 * of gap as the WebRTC probe found earlier this session: real protective
 * code, never proven by a real end-to-end assertion.
 *
 * Real finding while writing this test: the webview's default `about:blank`
 * document is not a secure context, so `getCurrentPosition` fails with
 * PERMISSION_DENIED there regardless of `geolocationMode` — a naive version
 * of the "blocked" test below passed for the wrong reason. Fixed by
 * navigating to a real `http://127.0.0.1` page first (a genuine Chromium
 * "potentially trustworthy origin" exception) before exercising the API.
 */
test.setTimeout(90_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;
let server: Server;
let serverPort: number;

const REMOTE_DEBUG_PORT = 9361;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-geoperm-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT) },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  // navigator.geolocation requires a secure context — about:blank (the
  // webview's default before any navigation) is NOT one, which would make
  // getCurrentPosition fail with PERMISSION_DENIED regardless of whether
  // our own permission handler grants or denies anything. `127.0.0.1` is a
  // real Chromium "potentially trustworthy origin" exception, so this is
  // the minimum real navigation needed to test the actual mechanism rather
  // than an artifact of not having navigated anywhere.
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>geo-test</title><body>geo-test</body>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverPort = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  await cdp?.close();
  await app.close();
  await rmSyncWithRetry(userDataDir);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function connectToShell(): Promise<Page> {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      cdp = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUG_PORT}`);
      for (const ctx of cdp.contexts()) {
        for (const page of ctx.pages()) {
          if (page.url().includes('browser-shell.html')) return page;
        }
      }
      await cdp.close();
      cdp = undefined;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Could not find browser-shell.html page via CDP: ${String(lastErr)}`);
}

async function createAndStartProfile(
  profileName: string,
  geolocationMode: 'real' | 'spoof' | 'blocked',
  permissionsMode: 'real' | 'deny-all',
): Promise<Page> {
  await window.getByPlaceholder('New profile name').fill(profileName);
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.getByText('fingerprint', { exact: true }).click();
  await window.getByLabel('Geolocation').selectOption(geolocationMode);
  await window.getByLabel('Other Permissions (camera, mic, notifications, clipboard, ...)').selectOption(permissionsMode);
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: profileName }) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const shell = await connectToShell();
  const webview = shell.locator('webview').first();
  await webview.waitFor({ state: 'attached', timeout: 15_000 });

  // Every new profile's webview auto-navigates to BROWSER_START_URL
  // (https://www.google.com, profileWindowEntry.ts) as soon as it attaches.
  // Typing the real test server's URL before that lands races against it —
  // found as a real, reproducible flake (address bar briefly reading
  // google.com instead of the real target) when re-running this file
  // alongside others. Waiting for the initial navigation to actually land
  // first removes the race.
  const address = shell.locator('#address');
  await expect(address).toHaveValue(/google\.com/, { timeout: 15_000 });
  await address.fill(`http://127.0.0.1:${serverPort}/`);
  await address.press('Enter');
  await expect(address).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${serverPort}`), { timeout: 15_000 });

  return shell;
}

async function evalInWebview(shell: Page, expr: string): Promise<unknown> {
  const webview = shell.locator('webview').first();
  return webview.evaluate(
    (el, e) => (el as unknown as { executeJavaScript: (s: string) => Promise<unknown> }).executeJavaScript(e),
    expr,
  );
}

async function stopProfile(profileName: string): Promise<void> {
  const row = window.locator('tr', { has: window.locator('td', { hasText: profileName }) });
  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  await cdp?.close();
  cdp = undefined;
}

test('geolocationMode "blocked" actually denies the geolocation permission in a live profile, not just in the schema', async () => {
  const profileName = 'E2E Geo Blocked';
  const shell = await createAndStartProfile(profileName, 'blocked', 'real');

  const permState = await evalInWebview(
    shell,
    `navigator.permissions.query({ name: 'geolocation' }).then(s => s.state)`,
  );
  expect(permState).toBe('denied');

  const posResult = (await evalInWebview(
    shell,
    `new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve({ ok: true }),
        (err) => resolve({ ok: false, code: err.code }),
      );
    })`,
  )) as { ok: boolean; code?: number };
  expect(posResult.ok).toBe(false);
  expect(posResult.code).toBe(1); // PERMISSION_DENIED

  await stopProfile(profileName);
});

test('geolocationMode "spoof" makes a live profile actually report the configured coordinates', async () => {
  const profileName = 'E2E Geo Spoof';
  const shell = await createAndStartProfile(profileName, 'spoof', 'real');

  const coords = (await evalInWebview(
    shell,
    `new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
        (err) => reject(new Error('geolocation error code ' + err.code)),
      );
    })`,
  )) as { lat: number; lon: number };

  // The configured lat/lon comes from the generator's locale data (real
  // values, not fabricated by this test) — read back from the profile's own
  // stored fingerprint (profiles:list only joins os/browserVersion, not the
  // full fingerprint, so this goes profiles:list -> fingerprintId ->
  // fingerprint:get) rather than hardcoding an expected number that would
  // silently drift if the locale pool changes.
  const fp = await window.evaluate(async (name) => {
    type Invoke = (channel: string, payload?: unknown) => Promise<unknown>;
    const api = (window as unknown as { profileforge: { invoke: Invoke } }).profileforge;
    const list = (await api.invoke('profiles:list', {})) as Array<{ name: string; fingerprintId: string }>;
    const profile = list.find((p) => p.name === name);
    if (!profile) throw new Error(`profile ${name} not found in profiles:list`);
    return api.invoke('fingerprint:get', { id: profile.fingerprintId });
  }, profileName);
  const { geolocationLatitude, geolocationLongitude } = fp as {
    geolocationLatitude: number;
    geolocationLongitude: number;
  };
  expect(coords.lat).toBeCloseTo(geolocationLatitude, 3);
  expect(coords.lon).toBeCloseTo(geolocationLongitude, 3);

  await stopProfile(profileName);
});

test('permissionsMode "deny-all" actually denies an unrelated permission (notifications) in a live profile', async () => {
  const profileName = 'E2E Perm DenyAll';
  const shell = await createAndStartProfile(profileName, 'real', 'deny-all');

  const permState = await evalInWebview(
    shell,
    `navigator.permissions.query({ name: 'notifications' }).then(s => s.state)`,
  );
  expect(permState).toBe('denied');

  await stopProfile(profileName);
});
