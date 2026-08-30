import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ProxyRecord } from '../../src/shared/schemas/proxy';

// A real TCP connection would make this test slow, flaky, and dependent on
// network/firewall state — testProxyConnection only needs a socket that
// emits the events Node's real net.Socket would, so a fake EventEmitter
// stands in for it. `connect` additionally reproduces Node's own synchronous
// port-range validation, since that's the exact mechanism the "invalid port"
// case below relies on.
const createdSockets: FakeSocket[] = [];

class FakeSocket extends EventEmitter {
  destroy = vi.fn();
  setTimeout = vi.fn();
  connect = vi.fn((port: number) => {
    if (!Number.isInteger(port) || port < 0 || port >= 65536) {
      throw new RangeError(`Port should be >= 0 and < 65536. Received type number (${port}).`);
    }
  });

  constructor() {
    super();
    createdSockets.push(this);
  }
}

vi.mock('node:net', () => ({
  default: { Socket: FakeSocket },
}));

const { testProxyConnection } = await import('../../src/main/proxy/proxyTester');

function makeProxy(overrides: Partial<ProxyRecord> = {}): ProxyRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Test Proxy',
    protocol: 'http',
    host: '127.0.0.1',
    port: 8080,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('testProxyConnection', () => {
  it('resolves success with latency when the socket connects', async () => {
    const promise = testProxyConnection(makeProxy(), null);
    const socket = createdSockets[createdSockets.length - 1]!;
    socket.emit('connect');

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(typeof result.latencyMs).toBe('number');
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('resolves failure on timeout', async () => {
    const promise = testProxyConnection(makeProxy(), null);
    const socket = createdSockets[createdSockets.length - 1]!;
    socket.emit('timeout');

    const result = await promise;
    expect(result).toEqual({ success: false, latencyMs: null, error: 'Connection timed out' });
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('resolves failure when the server refuses the connection', async () => {
    const promise = testProxyConnection(makeProxy({ port: 9999 }), null);
    const socket = createdSockets[createdSockets.length - 1]!;
    socket.emit('error', new Error('connect ECONNREFUSED 127.0.0.1:9999'));

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.latencyMs).toBeNull();
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('resolves failure when the host cannot be resolved', async () => {
    const promise = testProxyConnection(makeProxy({ host: 'this-host-does-not-exist.invalid' }), null);
    const socket = createdSockets[createdSockets.length - 1]!;
    socket.emit('error', new Error('getaddrinfo ENOTFOUND this-host-does-not-exist.invalid'));

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('ENOTFOUND');
  });

  it('rejects for a structurally invalid port instead of silently reporting failure', async () => {
    // Zod (ProxySchema) normally blocks an out-of-range port before this
    // function is ever reached — this exercises the function's own defense
    // if that guarantee were ever bypassed. Node's net.Socket.connect()
    // throws synchronously for this, which surfaces as a rejected promise
    // rather than a { success: false } result, unlike every other failure
    // mode above — worth knowing since callers only currently catch/await it.
    const badProxy = makeProxy({ port: 999999 as ProxyRecord['port'] });
    await expect(testProxyConnection(badProxy, null)).rejects.toThrow(/Port should be/);
  });
});
