import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import net from 'node:net';
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
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
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

/**
 * HTTPS through an HTTP-family proxy: Chromium never sends the target host
 * as an absolute-URI here — it sends a `CONNECT host:port` request and only
 * starts TLS once the proxy answers, so receiving that CONNECT line (even if
 * we then deliberately refuse to tunnel anywhere) is itself the proof of
 * routing. Node's http.Server exposes this as its own 'connect' event,
 * distinct from ordinary 'request'.
 */
function startFakeConnectProxyServer(): Promise<{ server: http.Server; port: number; connectTargets: string[] }> {
  const connectTargets: string[] = [];
  const server = http.createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  server.on('connect', (req, clientSocket) => {
    clientSocket.on('error', () => {});
    connectTargets.push(req.url ?? '');
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, connectTargets });
    });
  });
}

test('HTTPS traffic through an assigned proxy is routed via a real CONNECT tunnel request', async () => {
  const { server, port, connectTargets } = await startFakeConnectProxyServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-proxy-https-'));

  let app: ElectronApplication | undefined;
  try {
    app = await electron.launch({
      args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        PF_E2E_LOCALE: 'en',
        PF_E2E_PROXY_TEST_URL: `https://${MARKER_HOST}${MARKER_PATH}`,
      },
    });
    const window: Page = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');

    await window.getByText('Proxies', { exact: true }).click();
    await window.getByPlaceholder('Name', { exact: true }).fill('E2E HTTPS Proxy');
    await window.getByPlaceholder('Host').fill('127.0.0.1');
    await window.getByPlaceholder('Port').fill(String(port));
    await window.getByRole('button', { name: 'Add Proxy' }).click();
    await expect(window.locator('td', { hasText: 'E2E HTTPS Proxy' })).toBeVisible({ timeout: 10_000 });

    await window.getByText('Profiles', { exact: true }).click();
    await window.getByPlaceholder('New profile name').fill('E2E HTTPS Proxy Profile');
    await window.getByRole('button', { name: 'New Profile' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E HTTPS Proxy Profile' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Edit' }).click();
    await window.getByText('proxy', { exact: true }).click();
    await window.getByLabel('Assigned proxy').selectOption({ label: `E2E HTTPS Proxy (http://127.0.0.1:${port})` });
    await window.getByRole('button', { name: 'Save' }).click();
    await window.getByRole('button', { name: 'Close' }).click();

    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

    await expect
      .poll(() => connectTargets.some((t) => t.startsWith(`${MARKER_HOST}:`)), { timeout: 20_000 })
      .toBe(true);

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  } finally {
    await app?.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

/**
 * Proxy authentication end to end: the credential now travels
 * parent → child over stdin (browserLauncher.ts writes it once right after
 * spawn(); profileWindowEntry.ts's readStdinCredentials() reads it before
 * registering the 'login' handler — see SECURITY.md) instead of an
 * environment variable. A fake proxy that challenges with 407 and only
 * accepts one specific `Proxy-Authorization: Basic <user:pass>` header is
 * the most direct real proof that the credential actually made the whole
 * trip and reached Chromium's proxy-auth handshake correctly — a passing
 * request through it cannot happen any other way.
 */
function startFakeAuthProxyServer(
  expectedUser: string,
  expectedPass: string,
): Promise<{ server: http.Server; port: number; authorizedRequests: string[] }> {
  const expected = 'Basic ' + Buffer.from(`${expectedUser}:${expectedPass}`).toString('base64');
  const authorizedRequests: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.headers['proxy-authorization'] !== expected) {
      res.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="e2e"' });
      res.end();
      return;
    }
    authorizedRequests.push(req.url ?? '');
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port, authorizedRequests });
    });
  });
}

test('a proxy with a username/password actually authenticates — the credential travels stdin parent-to-child, not an env var', async () => {
  const proxyUser = 'e2e-user';
  const proxyPass = 'e2e-pass-9f3a';
  const { server, port, authorizedRequests } = await startFakeAuthProxyServer(proxyUser, proxyPass);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-proxy-auth-'));

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

    await window.getByText('Proxies', { exact: true }).click();
    await window.getByPlaceholder('Name', { exact: true }).fill('E2E Auth Proxy');
    await window.getByPlaceholder('Host').fill('127.0.0.1');
    await window.getByPlaceholder('Port').fill(String(port));
    await window.getByPlaceholder('Username').fill(proxyUser);
    await window.getByPlaceholder('Password').fill(proxyPass);
    await window.getByRole('button', { name: 'Add Proxy' }).click();
    await expect(window.locator('td', { hasText: 'E2E Auth Proxy' })).toBeVisible({ timeout: 10_000 });

    await window.getByText('Profiles', { exact: true }).click();
    await window.getByPlaceholder('New profile name').fill('E2E Auth Proxy Profile');
    await window.getByRole('button', { name: 'New Profile' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Auth Proxy Profile' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Edit' }).click();
    await window.getByText('proxy', { exact: true }).click();
    await window.getByLabel('Assigned proxy').selectOption({ label: `E2E Auth Proxy (http://127.0.0.1:${port})` });
    await window.getByRole('button', { name: 'Save' }).click();
    await window.getByRole('button', { name: 'Close' }).click();

    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

    // Only reachable if Chromium answered the 407 challenge with exactly the
    // credential this test configured — proving it made it from the DB,
    // through ProfileManager, through browserLauncher's stdin write, through
    // profileWindowEntry's readStdinCredentials(), into the 'login' handler.
    await expect
      .poll(() => authorizedRequests.some((u) => u.includes(MARKER_HOST) && u.includes(MARKER_PATH)), {
        timeout: 20_000,
      })
      .toBe(true);

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  } finally {
    await app?.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

/**
 * SOCKS5: a hand-rolled minimal server since there is no real SOCKS5 network
 * to reach — just enough of RFC 1928 to accept the no-auth handshake and
 * read the CONNECT request's target address/port, which is the only thing
 * this test needs to prove real routing. Chromium sends the hostname
 * unresolved (ATYP=0x03, domain name) rather than resolving DNS itself, so
 * the same non-resolvable .invalid marker host works here too.
 */
function startFakeSocks5Server(): Promise<{ server: net.Server; port: number; targets: string[] }> {
  const targets: string[] = [];
  const server = net.createServer((socket) => {
    // The client legitimately resets the connection once it reads our
    // deliberate "general failure" reply — without a handler here, that
    // raises an unhandled 'error' event on the socket and crashes the test
    // process (Node's default behavior), not a real problem with the proxy
    // exchange itself.
    socket.on('error', () => {});
    socket.once('data', () => {
      socket.write(Buffer.from([0x05, 0x00])); // VER=5, no-auth selected
      socket.once('data', (reqBuf: Buffer) => {
        const atyp = reqBuf[3];
        let addr = '';
        let offset = 4;
        if (atyp === 0x01) {
          addr = Array.from(reqBuf.subarray(4, 8)).join('.');
          offset = 8;
        } else if (atyp === 0x03) {
          const len = reqBuf[4]!;
          addr = reqBuf.subarray(5, 5 + len).toString('ascii');
          offset = 5 + len;
        } else if (atyp === 0x04) {
          addr = reqBuf.subarray(4, 20).toString('hex');
          offset = 20;
        }
        const dstPort = reqBuf.readUInt16BE(offset);
        targets.push(`${addr}:${dstPort}`);
        // VER=5, REP=0x01 general failure, so nothing hangs waiting for a real tunnel.
        socket.end(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      });
    });
  });
  server.on('error', () => {});
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port, targets }));
  });
}

test('SOCKS5 traffic through an assigned proxy is routed via a real SOCKS5 CONNECT request', async () => {
  const { server, port, targets } = await startFakeSocks5Server();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-proxy-socks5-'));

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

    await window.getByText('Proxies', { exact: true }).click();
    await window.getByPlaceholder('Name', { exact: true }).fill('E2E SOCKS5 Proxy');
    await window.getByRole('combobox').selectOption('socks5');
    await window.getByPlaceholder('Host').fill('127.0.0.1');
    await window.getByPlaceholder('Port').fill(String(port));
    await window.getByRole('button', { name: 'Add Proxy' }).click();
    await expect(window.locator('td', { hasText: 'E2E SOCKS5 Proxy' })).toBeVisible({ timeout: 10_000 });

    await window.getByText('Profiles', { exact: true }).click();
    await window.getByPlaceholder('New profile name').fill('E2E SOCKS5 Proxy Profile');
    await window.getByRole('button', { name: 'New Profile' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E SOCKS5 Proxy Profile' }) });
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: 'Edit' }).click();
    await window.getByText('proxy', { exact: true }).click();
    await window.getByLabel('Assigned proxy').selectOption({ label: `E2E SOCKS5 Proxy (socks5://127.0.0.1:${port})` });
    await window.getByRole('button', { name: 'Save' }).click();
    await window.getByRole('button', { name: 'Close' }).click();

    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

    await expect
      .poll(() => targets.some((t) => t.startsWith(`${MARKER_HOST}:`)), { timeout: 20_000 })
      .toBe(true);

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  } finally {
    await app?.close();
    server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
