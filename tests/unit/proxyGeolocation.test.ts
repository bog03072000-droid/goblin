import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import { geolocateHost } from '../../src/main/proxy/proxyGeolocation';

afterEach(() => {
  vi.restoreAllMocks();
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
