import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';

export interface AutomationProxyHandle {
  close(): void;
}

/** Finds a free TCP port on 127.0.0.1 by briefly binding to port 0 (the OS
 * picks a free one) and reading it back, then releasing it immediately.
 * There's a small TOCTOU race between release and Chromium actually binding
 * the same port — acceptable for a localhost-only port and the same
 * technique widely used by browser-automation tooling (including
 * Playwright's own launcher) for exactly this purpose. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        probe.close(() => resolve(port));
      } else {
        probe.close(() => reject(new Error('Could not determine a free port')));
      }
    });
  });
}

function timingSafeTokenMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Length is compared first (leaks only the length, which isn't secret —
  // every token this app generates is the same fixed length anyway) so
  // timingSafeEqual is never called on unequal-length buffers, which would
  // throw rather than return false.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractToken(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const queryToken = url.searchParams.get('token');
  if (queryToken) return queryToken;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}

/** Rewrites the one field of a /json/version or /json/list CDP response a
 * client actually connects to (webSocketDebuggerUrl) so it points back
 * through this proxy, token attached, instead of straight at the real
 * internal port. devtoolsFrontendUrl is left alone — it's for opening
 * Chromium's own human-facing inspector UI directly against the internal
 * port, not something an automation client parses or connects through. */
function rewriteWsUrl(value: unknown, proxyPort: number, internalPort: number, token: string): unknown {
  if (typeof value !== 'string') return value;
  if (!value.startsWith('ws://')) return value;
  try {
    const parsed = new URL(value);
    if (parsed.port !== String(internalPort)) return value;
    parsed.port = String(proxyPort);
    parsed.searchParams.set('token', token);
    return parsed.toString();
  } catch {
    return value;
  }
}

function rewriteCdpJson(body: string, proxyPort: number, internalPort: number, token: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body;
  }
  const rewriteOne = (obj: unknown): unknown => {
    if (!obj || typeof obj !== 'object') return obj;
    const record = obj as Record<string, unknown>;
    if ('webSocketDebuggerUrl' in record) {
      record['webSocketDebuggerUrl'] = rewriteWsUrl(record['webSocketDebuggerUrl'], proxyPort, internalPort, token);
    }
    return record;
  };
  const rewritten = Array.isArray(parsed) ? parsed.map(rewriteOne) : rewriteOne(parsed);
  return JSON.stringify(rewritten);
}

/**
 * Starts a token-gated reverse proxy in front of Chromium's own
 * --remote-debugging-port, which has NO authentication of its own — raw CDP
 * (what Puppeteer/Playwright/Selenium all speak) was never designed with a
 * token/auth handshake anywhere in the wire protocol, so this is the only
 * way to make "reject a connection without the right token" actually true
 * rather than cosmetic. See README's Automation section for the full
 * rationale.
 *
 * Real CDP stays bound to `internalPort` on 127.0.0.1 — a port never told to
 * anything but this proxy. A client only ever reaches it by presenting
 * `token` on `port` (also 127.0.0.1-only, never 0.0.0.0). The plain HTTP
 * JSON endpoints (/json/version, /json/list) are proxied with their
 * webSocketDebuggerUrl field rewritten to point back through this proxy
 * (token attached), so a client library's normal auto-discovery flow (e.g.
 * `puppeteer.connect({ browserURL })`, which fetches /json/version first)
 * keeps working with no special-casing on the client side. The WebSocket
 * upgrade itself is proxied as a raw byte pipe once authenticated — CDP's
 * own WebSocket framing is never parsed or reinterpreted, only forwarded,
 * so this proxy can't itself become a source of CDP-protocol bugs.
 */
export function startAutomationProxy(params: { port: number; internalPort: number; token: string }): Promise<AutomationProxyHandle> {
  const { port, internalPort, token } = params;

  function handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const provided = extractToken(req);
    if (!provided || !timingSafeTokenMatch(provided, token)) {
      res.writeHead(401, { 'content-type': 'text/plain' });
      res.end('Unauthorized: missing or invalid automation token');
      return;
    }
    const upstream = http.request(
      { host: '127.0.0.1', port: internalPort, path: req.url, method: req.method },
      (upstreamRes) => {
        const chunks: Buffer[] = [];
        upstreamRes.on('data', (c: Buffer) => chunks.push(c));
        upstreamRes.on('end', () => {
          const rewritten = rewriteCdpJson(Buffer.concat(chunks).toString('utf-8'), port, internalPort, token);
          res.writeHead(upstreamRes.statusCode ?? 200, { 'content-type': 'application/json' });
          res.end(rewritten);
        });
      },
    );
    upstream.on('error', () => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Bad gateway: could not reach the internal debugger port');
    });
    upstream.end();
  }

  const server = http.createServer(handleHttp);

  server.on('upgrade', (req: IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    const provided = extractToken(req);
    if (!provided || !timingSafeTokenMatch(provided, token)) {
      clientSocket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      clientSocket.destroy();
      return;
    }
    const targetSocket = net.connect(internalPort, '127.0.0.1', () => {
      // Replay the original upgrade request line + headers verbatim (minus
      // the query string, which carries the token the real CDP endpoint
      // doesn't know about and doesn't need) so Chromium's own upgrade
      // handshake proceeds exactly as it would for a direct connection.
      const rawPath = (req.url ?? '/').split('?')[0];
      const headerLines = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
        .join('\r\n');
      targetSocket.write(`GET ${rawPath} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
      if (head.length) targetSocket.write(head);
      // From here on this is just two TCP sockets spliced together — the
      // WebSocket frames flowing through are never parsed by this proxy in
      // either direction.
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });
    targetSocket.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => targetSocket.destroy());
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({ close: () => server.close() });
    });
  });
}
