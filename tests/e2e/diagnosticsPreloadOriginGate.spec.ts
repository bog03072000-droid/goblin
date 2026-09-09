import { test, expect, _electron as electron, chromium, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * `diagnosticsPreload.ts` is forced onto EVERY profile webview via
 * `will-attach-webview` — not just the diagnostics page's own
 * `profileforge://` origin, but also whatever real site the user browses to
 * in that same webview. Its own comment and SECURITY.md both describe the
 * `if (location.protocol === 'profileforge:')` guard as what stops an
 * arbitrary loaded website from calling the `pfDiagnostics.report` bridge to
 * spoof a fake fingerprint snapshot or spam the IPC channel — but grepping
 * every E2E spec for `pfDiagnostics` before this test returned zero matches.
 * Real protective code, described in comments and SECURITY.md, never once
 * proven against a real non-profileforge:// page — the same "exists but
 * unverified" pattern this audit already found for WebRTC and for
 * geolocation/permissions.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;
let server: Server;
let serverPort: number;

const REMOTE_DEBUG_PORT = 9362;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-preloadgate-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT) },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');

  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>arbitrary-site</title><body>arbitrary-site</body>');
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

test('a real, arbitrary http:// page loaded in a profile webview never gets window.pfDiagnostics — the origin gate actually holds', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Preload Gate');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Preload Gate' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const shell = await connectToShell();
  const address = shell.locator('#address');
  await address.fill(`http://127.0.0.1:${serverPort}/`);
  await address.press('Enter');
  await expect(address).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${serverPort}`), { timeout: 15_000 });

  const webview = shell.locator('webview').first();
  await webview.waitFor({ state: 'attached', timeout: 15_000 });
  const evalIn = async (expr: string) =>
    webview.evaluate(
      (el, e) => (el as unknown as { executeJavaScript: (s: string) => Promise<unknown> }).executeJavaScript(e),
      expr,
    );

  const hasBridge = await evalIn(`typeof window.pfDiagnostics !== 'undefined'`);
  expect(hasBridge).toBe(false);

  const protocolSeen = await evalIn('location.protocol');
  expect(protocolSeen).toBe('http:'); // confirms this really is the non-profileforge:// page, not a fallback

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
