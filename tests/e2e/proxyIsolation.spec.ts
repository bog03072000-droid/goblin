import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * proxyVerification.spec.ts already proves a single profile's traffic
 * genuinely routes through its assigned proxy. This file covers the
 * distinct concern Phase 6 asks for: with THREE profiles configured with
 * three DIFFERENT proxy assignments (including "none"), does each one only
 * ever use its OWN configuration — never another profile's proxy, and never
 * a proxy at all when none is assigned? Same local-fake-proxy-server
 * technique as proxyVerification.spec.ts, run sequentially (one profile at a
 * time) so which server received which profile's request is unambiguous.
 */
test.setTimeout(90_000);

const MARKER_HOST = 'proxy-isolation-test.invalid';
const MARKER_PATH = '/marker-7c2e';

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

test('three profiles with proxy A / proxy B / no proxy each use only their own configuration, never another profile\'s', async () => {
  const proxyA = await startFakeProxyServer();
  const proxyB = await startFakeProxyServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-proxy-isolation-'));

  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        PF_E2E_LOCALE: 'en',
        // Same marker target for every profile in this test — isolation is
        // proven by WHICH fake proxy server (if any) ends up receiving the
        // request, not by different target URLs per profile.
        PF_E2E_PROXY_TEST_URL: `http://${MARKER_HOST}${MARKER_PATH}`,
      },
    });
    const window: Page = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await window.getByText('Proxies', { exact: true }).click();
    await window.getByPlaceholder('Name', { exact: true }).fill('Isolation Proxy A');
    await window.getByPlaceholder('Host').fill('127.0.0.1');
    await window.getByPlaceholder('Port').fill(String(proxyA.port));
    await window.getByRole('button', { name: 'Add Proxy' }).click();
    await expect(window.locator('td', { hasText: 'Isolation Proxy A' })).toBeVisible({ timeout: 10_000 });

    await window.getByPlaceholder('Name', { exact: true }).fill('Isolation Proxy B');
    await window.getByPlaceholder('Host').fill('127.0.0.1');
    await window.getByPlaceholder('Port').fill(String(proxyB.port));
    await window.getByRole('button', { name: 'Add Proxy' }).click();
    await expect(window.locator('td', { hasText: 'Isolation Proxy B' })).toBeVisible({ timeout: 10_000 });

    await window.getByText('Profiles', { exact: true }).click();

    const createProfileWithProxy = async (name: string, proxyLabel: string | null): Promise<void> => {
      await window.getByPlaceholder('New profile name').fill(name);
      await window.getByRole('button', { name: 'New Profile' }).click();
      await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
      const row = window.locator('tr', { has: window.locator('td', { hasText: name }) });
      await expect(row).toBeVisible({ timeout: 15_000 });
      if (proxyLabel) {
        await row.getByRole('button', { name: 'Edit' }).click();
        await window.getByText('proxy', { exact: true }).click();
        await window.getByLabel('Assigned proxy').selectOption({ label: proxyLabel });
        await window.getByRole('button', { name: 'Save' }).click();
        await window.getByRole('button', { name: 'Close' }).click();
      }
    };

    await createProfileWithProxy('Isolation Profile A', `Isolation Proxy A (http://127.0.0.1:${proxyA.port})`);
    await createProfileWithProxy('Isolation Profile B', `Isolation Proxy B (http://127.0.0.1:${proxyB.port})`);
    await createProfileWithProxy('Isolation Profile C', null); // no proxy

    const startStopAndCheck = async (name: string): Promise<void> => {
      const row = window.locator('tr', { has: window.locator('td', { hasText: name }) });
      await row.getByRole('button', { name: 'Start', exact: true }).click();
      await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
      // Give the marker request (or lack of one) time to arrive.
      await window.waitForTimeout(3_000);
      await row.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
    };

    // Profile A: only proxy A should ever see this request.
    await startStopAndCheck('Isolation Profile A');
    expect(proxyA.requests.some((u) => u.includes(MARKER_HOST))).toBe(true);
    expect(proxyB.requests.some((u) => u.includes(MARKER_HOST))).toBe(false);

    // Profile B: only proxy B should see this NEW request — proxy A's count
    // must not grow (it must still hold only profile A's single request).
    const proxyACountBeforeB = proxyA.requests.length;
    await startStopAndCheck('Isolation Profile B');
    expect(proxyB.requests.some((u) => u.includes(MARKER_HOST))).toBe(true);
    expect(proxyA.requests.length).toBe(proxyACountBeforeB);

    // Profile C: no proxy assigned — neither fake server should ever see a
    // request from it (a direct connection to a .invalid host simply fails,
    // which is the correct, expected outcome, not a test failure).
    const proxyACountBeforeC = proxyA.requests.length;
    const proxyBCountBeforeC = proxyB.requests.length;
    await startStopAndCheck('Isolation Profile C');
    expect(proxyA.requests.length).toBe(proxyACountBeforeC);
    expect(proxyB.requests.length).toBe(proxyBCountBeforeC);
  } finally {
    await app?.close();
    proxyA.server.close();
    proxyB.server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
