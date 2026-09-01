import { test, expect, _electron as electron, chromium, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

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

const REMOTE_DEBUG_PORT = 9349;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-fp-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      PF_E2E_AUTO_DIAGNOSTICS: '1',
      PF_E2E_LOCALE: 'en',
      PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT),
    },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await cdp?.close();
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
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
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

  // deviceMemory is genuinely applied via the preload-injected spoofing
  // script (there's still no CDP Emulation method for it — see Finding 3 —
  // this is the JS-override path; moved off CDP's Page domain onto a real
  // <webview preload> injection in a later stage — see FINGERPRINT_AUDIT.md's
  // "CDP footprint reduction" section).
  expect(snapshot.statusByField['deviceMemory']).toBe('PASS');
  expect(Number(snapshot.observed['deviceMemory'])).toBe(Number(snapshot.configured['deviceMemory']));

  // Canvas/audio noise default to 'on' for a new profile (generator.ts) —
  // verify the override is actually installed and, critically, that it's
  // *deterministic*: the same canvas content read twice in a row produces
  // byte-identical output, not fresh random noise every call.
  expect(snapshot.statusByField['canvasMode']).toBe('APPLIED');
  expect(snapshot.observed['canvasDeterministic']).toBe(true);
  expect(snapshot.statusByField['audioMode']).toBe('APPLIED');

  // WebGL vendor/renderer now default to 'spoof' (generator.ts) — the real
  // GPU/ANGLE backend was the single largest practical detection gap when
  // left on the previous 'off' default, see docs/FINGERPRINT_AUDIT.md.
  expect(snapshot.statusByField['webglVendor']).toBe('PASS');
  expect(snapshot.observed['webglVendor']).toBe(snapshot.configured['webglVendor']);
  expect(snapshot.statusByField['webglRenderer']).toBe('PASS');
  expect(snapshot.observed['webglRenderer']).toBe(snapshot.configured['webglRenderer']);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('honestly unenforced-by-default properties are reported NOT_IMPLEMENTED, never a false PASS', async () => {
  const snapshot = readSnapshot();

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
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
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

test('webglSpoofingMode "spoof" actually overrides the observed vendor/renderer, and only those two — WebGL itself keeps working', async () => {
  const profilesRoot = path.join(userDataDir, 'profiles');
  const dirsBefore = new Set(fs.readdirSync(profilesRoot));

  await window.getByPlaceholder('New profile name').fill('E2E WebGL Spoof Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E WebGL Spoof Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('fingerprint', { exact: true }).click();
  await window.getByLabel('WebGL Vendor/Renderer Spoofing').selectOption({ label: 'Spoof (experimental)' });
  await expect(window.locator('.banner-warn')).toBeVisible(); // the compatibility-risk warning
  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const newDirs = () => fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d));
  await expect.poll(() => newDirs().length, { timeout: 30_000 }).toBeGreaterThan(0);
  const profileDir = newDirs()[0]!;
  const snapshotPath = path.join(profilesRoot, profileDir, 'fingerprint-snapshot.json');
  await expect.poll(() => fs.existsSync(snapshotPath), { timeout: 30_000 }).toBe(true);
  const snapshot = readSnapshotFrom(profileDir);

  // Enabled: the diagnostics page now reports a real, verified match instead
  // of the honest NOT_IMPLEMENTED the previous test asserts for the default
  // (off) case.
  expect(snapshot.statusByField['webglVendor']).toBe('PASS');
  expect(snapshot.observed['webglVendor']).toBe(snapshot.configured['webglVendor']);
  expect(snapshot.statusByField['webglRenderer']).toBe('PASS');
  expect(snapshot.observed['webglRenderer']).toBe(snapshot.configured['webglRenderer']);

  // Compatibility: a real, unrelated WebGL capability (MAX_TEXTURE_SIZE) is
  // still a plausible number — the getParameter() override only intercepts
  // the two UNMASKED_* params it's supposed to, not the whole API. Real
  // WebGL implementations report at least 2048 here (the GLES2 minimum).
  expect(Number(snapshot.observed['webglMaxTextureSize'])).toBeGreaterThanOrEqual(2048);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

/**
 * Registers a real Service Worker against a real, same-origin http(s) URL
 * — exactly CreepJS's own technique (`navigator.serviceWorker.register('./creep.js')`,
 * confirmed by reading its actual source) — and reads WebGL vendor/renderer
 * from inside that worker via `OffscreenCanvas`, the same path CreepJS's own
 * `getWebglData()` uses. A local fixture stands in for the real internet
 * dependency `creepjsBenchmark.spec.ts` needs (see that file's own comment
 * on why *that* test stays network-dependent by design; this one doesn't
 * need to be, since the point here is proving the code path, not scoring
 * against a real detector).
 */
function startServiceWorkerFixtureServer(): Promise<{ server: http.Server; port: number }> {
  const pageHtml = `<!doctype html><html><body><script>
    window.__swResult = null;
    navigator.serviceWorker.register('/sw.js').then(async (reg) => {
      await navigator.serviceWorker.ready;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => { window.__swResult = e.data; };
      (reg.active || reg.waiting || reg.installing).postMessage('go', [channel.port2]);
    }).catch((err) => { window.__swResult = { error: String(err) }; });
  </script></body></html>`;
  const swJs = `self.addEventListener('message', (event) => {
    try {
      var canvas = new OffscreenCanvas(256, 256);
      var gl = canvas.getContext('webgl');
      var ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      var vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : 'no-extension';
      var renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no-extension';
      event.ports[0].postMessage({ vendor: vendor, renderer: renderer });
    } catch (e) {
      event.ports[0].postMessage({ error: String(e) });
    }
  });`;
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(pageHtml);
    } else if (req.url === '/sw.js') {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end(swJs);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

async function connectToShellAt(port: number): Promise<Page> {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const client = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      for (const ctx of client.contexts()) {
        for (const page of ctx.pages()) {
          if (page.url().includes('browser-shell.html')) {
            cdp = client;
            return page;
          }
        }
      }
      await client.close();
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Could not find browser-shell.html page via CDP: ${String(lastErr)}`);
}

test('honest gap, verified in this test suite (not just an external capture someone has to notice): WebGL vendor/renderer spoofing does not reach a real Service Worker registered against a real http(s) script — same root cause as the documented Service Worker gap above, confirmed to leak the real GPU here too', async () => {
  const { server, port } = await startServiceWorkerFixtureServer();
  try {
    // dirsBefore must be captured BEFORE profile creation, not just before
    // Start — the profile's storage directory is created at profiles:create
    // time, not at start time, so a snapshot taken any later would already
    // include it and never see it as "new".
    const profilesRoot = path.join(userDataDir, 'profiles');
    fs.mkdirSync(profilesRoot, { recursive: true });
    const dirsBefore = new Set(fs.readdirSync(profilesRoot));

    await window.getByText('Profiles', { exact: true }).click();
    await window.getByPlaceholder('New profile name').fill('E2E SW WebGL Leak Profile');
    await window.getByRole('button', { name: 'New Profile' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E SW WebGL Leak Profile' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    // Default is webglSpoofingMode: 'spoof' since the fingerprint-default
    // stage — no manual toggle needed, this profile is spoofed like any
    // other new profile a real user would create.
    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
    const newDirs = () => fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d));
    await expect.poll(() => newDirs().length, { timeout: 30_000 }).toBeGreaterThan(0);
    const profileDir = newDirs()[0]!;
    // This profile launches with PF_E2E_AUTO_DIAGNOSTICS=1 like every other
    // profile in this file, so it auto-navigates to the diagnostics page and
    // writes fingerprint-snapshot.json once that page's own checks finish —
    // not instantly on RUNNING, so wait for the file before reading it
    // (same pattern the first test in this file uses).
    const snapshotPath = path.join(profilesRoot, profileDir, 'fingerprint-snapshot.json');
    await expect.poll(() => fs.existsSync(snapshotPath), { timeout: 30_000 }).toBe(true);
    const configuredWebglVendor = readSnapshotFrom(profileDir).configured['webglVendor'];
    const configuredWebglRenderer = readSnapshotFrom(profileDir).configured['webglRenderer'];

    const shell = await connectToShellAt(REMOTE_DEBUG_PORT);
    const address = shell.locator('#address');
    await address.fill(`http://127.0.0.1:${port}/`);
    await address.press('Enter');
    await expect(address).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${port}`), { timeout: 15_000 });

    const webview = shell.locator('webview').first();
    await webview.waitFor({ state: 'attached', timeout: 15_000 });

    let swResult: { vendor?: string; renderer?: string; error?: string } | null = null;
    for (let i = 0; i < 20; i++) {
      swResult = (await webview.evaluate((el) =>
        (el as unknown as { executeJavaScript: (s: string) => Promise<unknown> }).executeJavaScript('window.__swResult'),
      )) as typeof swResult;
      if (swResult) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    // The honest assertion: the Service Worker's own WebGL read is NOT the
    // configured spoofed value — it's the real host GPU, exactly like the
    // navigator-field leak documented above for the same root cause. If
    // this ever starts passing (observed === configured), that means the
    // Service Worker gap has actually been closed — update this test (and
    // FINGERPRINT_AUDIT.md's Service Worker section) to assert the
    // opposite, rather than leaving a now-stale "known gap" assertion in
    // place.
    expect(swResult).toBeTruthy();
    expect(swResult?.error).toBeUndefined();
    expect(swResult?.vendor).not.toBe(configuredWebglVendor);
    expect(swResult?.renderer).not.toBe(configuredWebglRenderer);

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  } finally {
    server.close();
  }
});
