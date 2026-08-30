import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * Verifies the browser process ACTUALLY routes traffic through its assigned
 * proxy — not merely that a proxy row exists in SQLite. This project's
 * environment can't reliably reach the real internet, so per the task's own
 * fallback instruction this is a local, deterministic proxy harness: a plain
 * Node HTTP server standing in for the proxy, receiving the browser's raw
 * HTTP-proxy request (an absolute-URI request line) and recording it.
 *
 * Chromium sends `http://` requests to an explicit HTTP proxy as an
 * absolute-URI request line addressed to the proxy's own socket — the
 * client never resolves or contacts the target host itself. That's what
 * makes this deterministic: no real DNS/network path to the "target" host
 * is required for the proxy to genuinely receive and prove the request.
 */
test.setTimeout(60_000);

const MARKER_HOST = 'proxy-verification-test.invalid';
const MARKER_PATH = '/marker-9f3a';

function startFakeProxyServer(): Promise<{ server: http.Server; port: number; requests: string[] }> {
  const requests: string[] = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, requests });
    });
  });
}

test('a profile with an assigned proxy genuinely routes its browser traffic through that proxy', async () => {
  const { server, port, requests } = await startFakeProxyServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-proxy-'));

  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        PF_E2E_LOCALE: 'en',
        PF_E2E_PROXY_TEST_URL: `http://${MARKER_HOST}${MARKER_PATH}`,
      },
    });
    const window: Page = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    // Create the proxy pointed at the local fake server, through the real UI.
    await window.getByText('Proxies', { exact: true }).click();
    await window.getByPlaceholder('Name', { exact: true }).fill('E2E Local Proxy');
    await window.getByPlaceholder('Host').fill('127.0.0.1');
    await window.getByPlaceholder('Port').fill(String(port));
    await window.getByRole('button', { name: 'Add Proxy' }).click();
    await expect(window.locator('td', { hasText: 'E2E Local Proxy' })).toBeVisible({ timeout: 10_000 });

    // Create a profile and assign the proxy to it via the editor.
    await window.getByText('Profiles', { exact: true }).click();
    await window.getByPlaceholder('New profile name').fill('E2E Proxy Profile');
    await window.getByRole('button', { name: 'New Profile' }).click();
    const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Proxy Profile' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Edit' }).click();
    await window.getByText('proxy', { exact: true }).click();
    await window.getByLabel('Assigned proxy').selectOption({ label: `E2E Local Proxy (http://127.0.0.1:${port})` });
    await window.getByRole('button', { name: 'Save' }).click();
    await window.getByRole('button', { name: 'Close' }).click();

    // Start the profile — PF_E2E_PROXY_TEST_URL makes its first tab navigate
    // straight to our marker URL instead of the normal home page.
    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

    await expect
      .poll(() => requests.some((u) => u.includes(MARKER_HOST) && u.includes(MARKER_PATH)), { timeout: 20_000 })
      .toBe(true);

    // The request line the fake proxy actually received is a real absolute-URI
    // HTTP-proxy request — proof the browser process used the assigned proxy,
    // not a direct connection (which would never have reached this server at all).
    const matched = requests.find((u) => u.includes(MARKER_HOST));
    expect(matched).toContain(`http://${MARKER_HOST}${MARKER_PATH}`);

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  } finally {
    await app?.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
