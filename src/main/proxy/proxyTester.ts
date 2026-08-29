import net from 'node:net';
import type { ProxyRecord, ProxyTestResult } from '../../shared/schemas/proxy';

/**
 * Verifies only that the proxy host:port accepts a TCP connection within the
 * timeout. This confirms reachability, not that authentication or tunneling
 * succeeds — documented here rather than silently implied to be a full check.
 */
export function testProxyConnection(proxy: ProxyRecord, _password: string | null): Promise<ProxyTestResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = new net.Socket();
    const timeoutMs = 5000;

    const finish = (result: ProxyTestResult): void => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ success: true, latencyMs: Date.now() - start, error: null }));
    socket.once('timeout', () => finish({ success: false, latencyMs: null, error: 'Connection timed out' }));
    socket.once('error', (err) => finish({ success: false, latencyMs: null, error: err.message }));

    socket.connect(proxy.port, proxy.host);
  });
}
