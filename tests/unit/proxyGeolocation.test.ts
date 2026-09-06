import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';

const closeMock = vi.fn(async () => undefined);
let lastProxyAgentUri: string | undefined;
let fetchImpl: (url: string, opts: unknown) => Promise<{ json: () => Promise<unknown> }> = async () => {
  throw new Error('fetchImpl not set for this test');
};

class FakeProxyAgent {
  close = closeMock;
  constructor(uri: string) {
    lastProxyAgentUri = uri;
  }
}

vi.mock('undici', () => ({
  ProxyAgent: FakeProxyAgent,
  fetch: vi.fn((url: string, opts: unknown) => fetchImpl(url, opts)),
}));

const { geolocateHost, geolocateThroughProxy, geolocateProxy } = await import('../../src/main/proxy/proxyGeolocation');

afterEach(() => {
  vi.restoreAllMocks();
  closeMock.mockClear();
  lastProxyAgentUri = undefined;
});

/** Fakes http.get's callback-based response without a real network call —
 * the request object is a bare EventEmitter (only 'error'/'timeout' and
 * .destroy() are ever used by geolocateHost), and the response is an
 * EventEmitter too, since http.IncomingMessage is itself a stream. */
function mockHttpGet(responseBody: string | null, opts: { errorOnRequest?: boolean; timeoutOnRequest?: boolean } = {}) {
  const req = new EventEmitter() as EventEmitter & { destroy: () => void };
  req.destroy = vi.fn();
  vi.spyOn(http, 'get').mockImplementation((...args: unknown[]) => {
    const callback = args.find((a) => typeof a === 'function') as ((res: EventEmitter) => void) | undefined;
    if (opts.errorOnRequest) {
      queueMicrotask(() => req.emit('error', new Error('network down')));
    } else if (opts.timeoutOnRequest) {
      queueMicrotask(() => req.emit('timeout'));
    } else if (callback && responseBody !== null) {
      const res = new EventEmitter();
      callback(res);
      queueMicrotask(() => {
        res.emit('data', Buffer.from(responseBody, 'utf-8'));
        res.emit('end');
      });
    }
    return req as unknown as ReturnType<typeof http.get>;
  });
  return req;
}

describe('geolocateHost', () => {
  it('resolves country/countryCode/timezone on a successful response', async () => {
    mockHttpGet(JSON.stringify({ status: 'success', country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' }));
    const result = await geolocateHost('1.2.3.4');
    expect(result).toEqual({ country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' });
  });

  it('resolves null when the API reports a non-success status (e.g. invalid host)', async () => {
    mockHttpGet(JSON.stringify({ status: 'fail', message: 'invalid query' }));
    expect(await geolocateHost('not-a-real-host')).toBeNull();
  });

  it('resolves null when the response is missing a required field', async () => {
    mockHttpGet(JSON.stringify({ status: 'success', country: 'Germany', countryCode: 'DE' }));
    expect(await geolocateHost('1.2.3.4')).toBeNull();
  });

  it('resolves null when the response body is not valid JSON', async () => {
    mockHttpGet('not json at all');
    expect(await geolocateHost('1.2.3.4')).toBeNull();
  });

  it('resolves null when the request itself errors (e.g. no network)', async () => {
    mockHttpGet(null, { errorOnRequest: true });
    expect(await geolocateHost('1.2.3.4')).toBeNull();
  });

  it('resolves null and destroys the request when it times out', async () => {
    const req = mockHttpGet(null, { timeoutOnRequest: true });
    expect(await geolocateHost('1.2.3.4')).toBeNull();
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });

  it('URL-encodes the host in the request', async () => {
    let requestedUrl = '';
    vi.spyOn(http, 'get').mockImplementation((...args: unknown[]) => {
      requestedUrl = args[0] as string;
      const req = new EventEmitter() as EventEmitter & { destroy: () => void };
      req.destroy = vi.fn();
      return req as unknown as ReturnType<typeof http.get>;
    });
    void geolocateHost('some host/with?special&chars');
    expect(requestedUrl).toContain(encodeURIComponent('some host/with?special&chars'));
  });
});

describe('geolocateThroughProxy', () => {
  it('returns unsupported-protocol for socks5 without ever calling fetch', async () => {
    const result = await geolocateThroughProxy({ protocol: 'socks5', host: '1.2.3.4', port: 1080, username: null }, null);
    expect(result).toEqual({ ok: false, reason: 'unsupported-protocol' });
    expect(lastProxyAgentUri).toBeUndefined();
  });

  it('builds a ProxyAgent URI with no auth segment when the proxy has no username', async () => {
    fetchImpl = async () => ({
      json: async () => ({ status: 'success', country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' }),
    });
    await geolocateThroughProxy({ protocol: 'http', host: '1.2.3.4', port: 8080, username: null }, null);
    expect(lastProxyAgentUri).toBe('http://1.2.3.4:8080');
  });

  it('builds a ProxyAgent URI with URL-encoded credentials when the proxy has a username/password', async () => {
    fetchImpl = async () => ({
      json: async () => ({ status: 'success', country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' }),
    });
    await geolocateThroughProxy({ protocol: 'http', host: '1.2.3.4', port: 8080, username: 'user@x' }, 'p@ss:word');
    expect(lastProxyAgentUri).toBe(`http://${encodeURIComponent('user@x')}:${encodeURIComponent('p@ss:word')}@1.2.3.4:8080`);
  });

  it('returns ok:true with verifiedThroughTunnel:true on a successful response', async () => {
    fetchImpl = async () => ({
      json: async () => ({ status: 'success', country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' }),
    });
    const result = await geolocateThroughProxy({ protocol: 'https', host: '1.2.3.4', port: 443, username: null }, null);
    expect(result).toEqual({
      ok: true,
      verifiedThroughTunnel: true,
      geo: { country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' },
    });
  });

  it('returns lookup-failed when the API reports a non-success status', async () => {
    fetchImpl = async () => ({ json: async () => ({ status: 'fail', message: 'invalid' }) });
    const result = await geolocateThroughProxy({ protocol: 'http', host: '1.2.3.4', port: 8080, username: null }, null);
    expect(result).toEqual({ ok: false, reason: 'lookup-failed' });
  });

  it('returns lookup-failed when fetch throws (e.g. proxy unreachable)', async () => {
    fetchImpl = async () => {
      throw new Error('connection refused');
    };
    const result = await geolocateThroughProxy({ protocol: 'http', host: '1.2.3.4', port: 8080, username: null }, null);
    expect(result).toEqual({ ok: false, reason: 'lookup-failed' });
  });

  it('always closes the ProxyAgent dispatcher, on success and on failure', async () => {
    fetchImpl = async () => ({
      json: async () => ({ status: 'success', country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' }),
    });
    await geolocateThroughProxy({ protocol: 'http', host: '1.2.3.4', port: 8080, username: null }, null);
    expect(closeMock).toHaveBeenCalledTimes(1);

    fetchImpl = async () => {
      throw new Error('boom');
    };
    await geolocateThroughProxy({ protocol: 'http', host: '1.2.3.4', port: 8080, username: null }, null);
    expect(closeMock).toHaveBeenCalledTimes(2);
  });
});

describe('geolocateProxy', () => {
  it('returns the tunnel result directly for http/https proxies without falling back to geolocateHost', async () => {
    fetchImpl = async () => ({
      json: async () => ({ status: 'success', country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' }),
    });
    const httpGetSpy = vi.spyOn(http, 'get');
    const result = await geolocateProxy({ protocol: 'http', host: '1.2.3.4', port: 8080, username: null }, null);
    expect(result).toEqual({
      ok: true,
      verifiedThroughTunnel: true,
      geo: { country: 'Germany', countryCode: 'DE', timezone: 'Europe/Berlin' },
    });
    expect(httpGetSpy).not.toHaveBeenCalled();
  });

  it('falls back to a host-only lookup for socks5, flagged as verifiedThroughTunnel:false', async () => {
    mockHttpGet(JSON.stringify({ status: 'success', country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' }));
    const result = await geolocateProxy({ protocol: 'socks5', host: '5.6.7.8', port: 1080, username: null }, null);
    expect(result).toEqual({
      ok: true,
      verifiedThroughTunnel: false,
      geo: { country: 'Japan', countryCode: 'JP', timezone: 'Asia/Tokyo' },
    });
  });

  it('returns lookup-failed for socks5 when the host-only fallback also fails', async () => {
    mockHttpGet(JSON.stringify({ status: 'fail' }));
    const result = await geolocateProxy({ protocol: 'socks5', host: '5.6.7.8', port: 1080, username: null }, null);
    expect(result).toEqual({ ok: false, reason: 'lookup-failed' });
  });
});
