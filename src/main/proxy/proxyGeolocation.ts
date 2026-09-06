import http from 'node:http';
import { ProxyAgent, fetch as undiciFetch } from 'undici';

export interface ProxyGeolocation {
  country: string;
  countryCode: string;
  timezone: string;
}

export type ProxyGeolocationResult =
  | { ok: true; geo: ProxyGeolocation; verifiedThroughTunnel: boolean }
  | { ok: false; reason: 'unsupported-protocol' | 'lookup-failed' };

/**
 * Geolocates the proxy's own configured host — NOT verified through an
 * actual tunneled request through the proxy itself. Kept as the fallback
 * `geolocateProxy()` below uses for `socks5` proxies (see that function's
 * doc comment for why a real tunnel check isn't available for those). For
 * many real proxy providers (a dedicated per-session residential IP, most
 * datacenter proxies) the configured host IS the actual exit IP, so this
 * is still a real, useful signal on its own; for a rotating gateway
 * hostname it reflects the gateway's own declared location, which may or
 * may not match where traffic actually exits.
 *
 * ip-api.com's free tier is HTTP-only (no HTTPS on the free plan) and
 * rate-limited to ~45 requests/minute — acceptable for an on-demand,
 * one-proxy-at-a-time check triggered by a user action (see
 * ProxiesPage.tsx's "Check location" button), not for automatically
 * geolocating every stored proxy in bulk.
 */
export function geolocateHost(host: string): Promise<ProxyGeolocation | null> {
  return new Promise((resolve) => {
    const req = http.get(
      `http://ip-api.com/json/${encodeURIComponent(host)}?fields=status,message,country,countryCode,timezone`,
      { timeout: 5000 },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf-8');
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as {
              status: string;
              country?: string;
              countryCode?: string;
              timezone?: string;
            };
            if (data.status !== 'success' || !data.country || !data.countryCode || !data.timezone) {
              resolve(null);
              return;
            }
            resolve({ country: data.country, countryCode: data.countryCode, timezone: data.timezone });
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Geolocates the proxy by actually routing the geolocation request THROUGH
 * it — the answer this feature originally wanted (see geolocateHost's own
 * comment about that gap): ip-api.com sees whatever IP the request
 * genuinely arrives from, which for a tunneled request is the proxy's real
 * egress point, not the proxy's own advertised host. Uses `undici`'s
 * `ProxyAgent`, which speaks the real HTTP `CONNECT` tunneling protocol
 * (the same mechanism `tests/e2e/proxyVerification.spec.ts` verifies this
 * project's actual browser traffic uses) — this is genuinely different
 * from, and strictly better than, geolocateHost() above.
 *
 * `http`/`https` protocol proxies only: `ProxyAgent` tunnels via HTTP
 * CONNECT, which SOCKS5 proxies don't speak at all — a SOCKS5 client is a
 * different, incompatible protocol implementation this project has no
 * dependency for. Rather than silently mislabeling a host-only lookup as
 * tunnel-verified for SOCKS5 proxies, callers get an explicit
 * `unsupported-protocol` result and fall back to geolocateHost() with that
 * limitation clearly surfaced (see geolocateProxy() below and
 * ProxiesPage.tsx's rendering of the two cases).
 */
export async function geolocateThroughProxy(
  proxy: { protocol: 'http' | 'https' | 'socks5'; host: string; port: number; username?: string | null },
  password: string | null,
): Promise<ProxyGeolocationResult> {
  if (proxy.protocol === 'socks5') {
    return { ok: false, reason: 'unsupported-protocol' };
  }

  const auth = proxy.username ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(password ?? '')}@` : '';
  const dispatcher = new ProxyAgent(`http://${auth}${proxy.host}:${proxy.port}`);
  try {
    const res = await undiciFetch('http://ip-api.com/json/?fields=status,message,country,countryCode,timezone', {
      dispatcher,
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { status: string; country?: string; countryCode?: string; timezone?: string };
    if (data.status !== 'success' || !data.country || !data.countryCode || !data.timezone) {
      return { ok: false, reason: 'lookup-failed' };
    }
    return {
      ok: true,
      verifiedThroughTunnel: true,
      geo: { country: data.country, countryCode: data.countryCode, timezone: data.timezone },
    };
  } catch {
    return { ok: false, reason: 'lookup-failed' };
  } finally {
    await dispatcher.close();
  }
}

/**
 * The single entry point ProxiesPage.tsx's "Check location" button calls:
 * tries the real tunnel check for http/https proxies, and falls back to
 * the host-only lookup (clearly flagged as such via
 * `verifiedThroughTunnel: false`) for SOCKS5 proxies, where a tunnel check
 * isn't available. Never silently presents a host-only result as
 * tunnel-verified.
 */
export async function geolocateProxy(
  proxy: { protocol: 'http' | 'https' | 'socks5'; host: string; port: number; username?: string | null },
  password: string | null,
): Promise<ProxyGeolocationResult> {
  const throughTunnel = await geolocateThroughProxy(proxy, password);
  if (throughTunnel.ok || throughTunnel.reason !== 'unsupported-protocol') {
    return throughTunnel;
  }
  const hostGeo = await geolocateHost(proxy.host);
  if (!hostGeo) return { ok: false, reason: 'lookup-failed' };
  return { ok: true, geo: hostGeo, verifiedThroughTunnel: false };
}
