import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import net from 'node:net';
import { findFreePort, startAutomationProxy, type AutomationProxyHandle } from '../../src/main/browser/automationProxy';

const TOKEN = 'real-token-abc123';

/** A minimal stand-in for Chromium's own --remote-debugging-port HTTP
 * endpoint — just enough of /json/version's real shape (a
 * webSocketDebuggerUrl field pointing at itself) for the proxy's rewrite
 * logic to have something real to rewrite. */
function startFakeInternalCdp(port: number): http.Server {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        Browser: 'FakeChrome/1.0',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake-id`,
      }),
    );
  });
  server.listen(port, '127.0.0.1');
  return server;
}

function httpGet(url: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
      })
      .on('error', reject);
  });
}

describe('automationProxy token validation', () => {
  let internalPort: number;
  let proxyPort: number;
  let internalServer: http.Server;
  let proxyHandle: AutomationProxyHandle;

  beforeEach(async () => {
    internalPort = await findFreePort();
    proxyPort = await findFreePort();
    internalServer = startFakeInternalCdp(internalPort);
    proxyHandle = await startAutomationProxy({ port: proxyPort, internalPort, token: TOKEN });
  });

  afterEach(() => {
    proxyHandle.close();
    internalServer.close();
  });

  it('rejects a request with no token at all', async () => {
    const res = await httpGet(`http://127.0.0.1:${proxyPort}/json/version`);
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong token', async () => {
    const res = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=wrong-token`);
    expect(res.status).toBe(401);
  });

  it('accepts the correct token as a query param and proxies through to the real internal endpoint', async () => {
    const res = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=${TOKEN}`);
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as { Browser: string };
    expect(parsed.Browser).toBe('FakeChrome/1.0');
  });

  it('accepts the correct token as an Authorization Bearer header', async () => {
    const res = await httpGet(`http://127.0.0.1:${proxyPort}/json/version`, { Authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
  });

  it('rewrites webSocketDebuggerUrl to point back through the proxy port with the token attached, not the real internal port', async () => {
    const res = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=${TOKEN}`);
    const parsed = JSON.parse(res.body) as { webSocketDebuggerUrl: string };
    expect(parsed.webSocketDebuggerUrl).toContain(`127.0.0.1:${proxyPort}`);
    expect(parsed.webSocketDebuggerUrl).toContain(`token=${TOKEN}`);
    expect(parsed.webSocketDebuggerUrl).not.toContain(`127.0.0.1:${internalPort}`);
  });

  it('a WebSocket upgrade attempt with no token is rejected with 401 before any data reaches the real internal port', async () => {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(proxyPort, '127.0.0.1', () => {
        socket.write(
          `GET /devtools/browser/fake-id HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString('utf-8');
        resolve(data);
        socket.destroy();
      });
      socket.on('error', reject);
      setTimeout(() => reject(new Error('timed out waiting for a response')), 3000);
    });
    expect(response).toContain('401');
  });
});
