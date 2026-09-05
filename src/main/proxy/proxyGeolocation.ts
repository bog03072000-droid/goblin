import http from 'node:http';

export interface ProxyGeolocation {
  country: string;
  countryCode: string;
  timezone: string;
}

/**
 * Geolocates the proxy's own configured host — NOT verified through an
 * actual tunneled request through the proxy itself. This project has no
 * HTTP/SOCKS CONNECT-tunneling helper (see proxyTester.ts's own doc
 * comment: it only tests raw TCP reachability, never a real proxied
 * request), so building genuine "what does this proxy's traffic look like
 * on the wire" verification would mean adding that capability from
 * scratch — out of scope here. For many real proxy providers (a dedicated
 * per-session residential IP, most datacenter proxies) the configured host
 * IS the actual exit IP, so this is still a real, useful signal; for a
 * rotating gateway hostname it reflects the gateway's own declared
 * location, which may or may not match where traffic actually exits.
 * Documented here rather than silently assumed to be a full verification.
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
