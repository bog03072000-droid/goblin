import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import { findFreePort, startAutomationProxy, AuthRateLimiter, type AutomationProxyHandle } from '../../src/main/browser/automationProxy';

const TOKEN = 'real-token-abc123';

function startFakeInternalCdp(port: number): http.Server {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ Browser: 'FakeChrome/1.0', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake-id` }));
  });
  server.listen(port, '127.0.0.1');
  return server;
}

function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      })
      .on('error', reject);
  });
}

describe('AuthRateLimiter (pure logic)', () => {
  it('does not block until maxAttempts failures have been recorded', () => {
    const limiter = new AuthRateLimiter(3, 60_000);
    expect(limiter.isBlocked('a')).toBe(false);
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(false);
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(true);
  });

  it('tracks each source independently', () => {
    const limiter = new AuthRateLimiter(2, 60_000);
    limiter.recordFailure('a');
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(true);
    expect(limiter.isBlocked('b')).toBe(false);
  });

  it('a success clears the source\'s failure count', () => {
    const limiter = new AuthRateLimiter(2, 60_000);
    limiter.recordFailure('a');
    limiter.recordSuccess('a');
    limiter.recordFailure('a');
    expect(limiter.isBlocked('a')).toBe(false);
  });

  it('the window resets after windowMs elapses', () => {
    vi.useFakeTimers();
    try {
      const limiter = new AuthRateLimiter(2, 1_000);
      limiter.recordFailure('a');
      limiter.recordFailure('a');
      expect(limiter.isBlocked('a')).toBe(true);
      vi.advanceTimersByTime(1_001);
      expect(limiter.isBlocked('a')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('automationProxy rate limiting (real server, real sockets)', () => {
  let internalPort: number;
  let proxyPort: number;
  let internalServer: http.Server;
  let proxyHandle: AutomationProxyHandle;

  beforeEach(async () => {
    internalPort = await findFreePort();
    proxyPort = await findFreePort();
    internalServer = startFakeInternalCdp(internalPort);
    // A tiny limit so the test doesn't need to fire the production default
    // (20) of requests to prove the behavior.
    proxyHandle = await startAutomationProxy({ port: proxyPort, internalPort, token: TOKEN, rateLimiter: new AuthRateLimiter(3, 60_000) });
  });

  afterEach(() => {
    proxyHandle.close();
    internalServer.close();
  });

  it('responds 401 to each of the first few bad-token attempts, then 429 once the limit is hit', async () => {
    const first = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=wrong`);
    expect(first.status).toBe(401);
    const second = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=wrong`);
    expect(second.status).toBe(401);
    const third = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=wrong`);
    expect(third.status).toBe(401);

    const fourth = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=wrong`);
    expect(fourth.status).toBe(429);
    expect(fourth.headers['retry-after']).toBeDefined();
  });

  it('blocks the correct token too once rate-limited — the point is throttling the source, not just wrong guesses', async () => {
    for (let i = 0; i < 3; i++) {
      await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=wrong`);
    }

    const res = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=${TOKEN}`);
    expect(res.status).toBe(429);
  });

  it('a request with the correct token before the limit is hit still succeeds normally', async () => {
    await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=wrong`);
    const res = await httpGet(`http://127.0.0.1:${proxyPort}/json/version?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });
});
