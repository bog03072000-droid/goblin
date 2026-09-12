import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * Real, end-to-end proof that an unpacked extension configured for a
 * profile is actually loaded into that profile's real running Chromium
 * session — a real MV3 extension fixture (manifest.json + a content
 * script), a real local HTTP page it's told to match, and reading the
 * actual DOM mutation the content script performs back out of the real
 * webview, not a mock of any layer. `PF_E2E_EXTENSION_DIRECTORY` (see
 * registerIpc.ts's own comment on profiles:pickExtensionDirectory)
 * substitutes for the native folder picker Playwright can't drive.
 */
test.setTimeout(60_000);

const REMOTE_DEBUG_PORT = 9366;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let extensionDir: string;
let server: http.Server;
let serverPort: number;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-extensions-'));
  extensionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-extension-fixture-'));

  fs.writeFileSync(
    path.join(extensionDir, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'E2E Marker Extension',
      version: '1.0',
      content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_start' }],
    }),
  );
  fs.writeFileSync(
    path.join(extensionDir, 'content.js'),
    // Marks the real page's DOM the moment this content script runs — real
    // proof the extension executed inside the guest page, not just that it
    // "loaded" according to Electron's own bookkeeping.
    "document.addEventListener('DOMContentLoaded', function () { document.title = 'EXT-MARKER-' + document.title; var el = document.createElement('div'); el.id = 'e2e-extension-marker'; el.textContent = 'injected-by-extension'; document.body.appendChild(el); });",
  );

  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><head><title>Fixture Page</title></head><body><h1>Fixture</h1></body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverPort = (server.address() as AddressInfo).port;

  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      PF_E2E_LOCALE: 'en',
      PF_E2E_EXTENSION_DIRECTORY: extensionDir,
      PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT),
    },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  await rmSyncWithRetry(userDataDir);
  fs.rmSync(extensionDir, { recursive: true, force: true });
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function execInWebview(webview: ReturnType<Page['locator']>, script: string): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < 20; i++) {
    try {
      return await webview.evaluate(
        (el, s) => (el as unknown as { executeJavaScript: (s: string) => Promise<unknown> }).executeJavaScript(s),
        script,
      );
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

test('an extension added via the Advanced tab is really loaded and its content script really runs in the profile', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Extension Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Extension Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();

  await expect(window.getByText(/full permissions its manifest declares/)).toBeVisible();
  await window.getByRole('button', { name: 'Add extension…' }).click();
  await expect(window.getByText(extensionDir)).toBeVisible({ timeout: 10_000 });
  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const shell = await connectToShellAt();
  const address = shell.locator('#address');
  await address.fill(`http://127.0.0.1:${serverPort}/`);
  await address.press('Enter');
  await expect(address).toHaveValue(new RegExp(`127\\.0\\.0\\.1:${serverPort}`), { timeout: 15_000 });

  const webview = shell.locator('webview').first();
  await webview.waitFor({ state: 'attached', timeout: 15_000 });

  const title = await execInWebview(webview, 'document.title');
  expect(title).toContain('EXT-MARKER-');

  const markerText = await execInWebview(
    webview,
    "document.getElementById('e2e-extension-marker') ? document.getElementById('e2e-extension-marker').textContent : null",
  );
  expect(markerText).toBe('injected-by-extension');

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

async function connectToShellAt(): Promise<Page> {
  const { chromium } = await import('@playwright/test');
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      const cdp = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUG_PORT}`);
      for (const ctx of cdp.contexts()) {
        for (const page of ctx.pages()) {
          if (page.url().includes('browser-shell.html')) return page;
        }
      }
      await cdp.close();
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Could not find browser-shell.html page via CDP: ${String(lastErr)}`);
}
