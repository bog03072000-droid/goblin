import type { ProxyRepository } from '../database/proxyRepository';
import { testProxyConnection } from './proxyTester';
import { log } from '../logger';

/** How often the scheduler re-checks every stored proxy. Overridable for
 * tests only (see the PF_E2E_ and PF_SOFT_DELETE_WINDOW_MS convention) —
 * never meant to be end-user configurable. */
const DEFAULT_INTERVAL_MS = Number(process.env['PF_PROXY_HEALTH_CHECK_INTERVAL_MS'] ?? 5 * 60_000);

/**
 * Periodically re-tests every stored proxy's reachability, independent of
 * the manual "Test" button in ProxiesPage.tsx — so a proxy that goes dead
 * between sessions shows up as FAIL in the UI without the user having to
 * remember to click Test themselves. Results land in the same
 * last_check_status/last_checked_at/last_check_latency_ms columns the
 * manual test writes to (see proxyRepository.ts's recordCheckResult), so
 * the UI badge always reflects whichever check — manual or scheduled — ran
 * most recently.
 *
 * Checks run sequentially, not in parallel, and never touch a running
 * profile's actual proxied connection — testProxyConnection() only opens
 * its own separate, short-lived TCP probe.
 */
export class ProxyHealthScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly proxies: ProxyRepository,
    private readonly intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, this.intervalMs);
    this.timer.unref();
    // Also run once shortly after startup, rather than waiting a full
    // interval for the first real signal.
    setTimeout(() => void this.runOnce(), 5_000).unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(): Promise<void> {
    const list = this.proxies.list();
    for (const proxy of list) {
      try {
        const result = await testProxyConnection(proxy, null);
        this.proxies.recordCheckResult(proxy.id, result);
      } catch (err) {
        // A check failing to even run (not the same as the proxy itself
        // failing to connect, which testProxyConnection already reports as
        // { success: false }) should never take the scheduler down for
        // every other proxy in the list.
        log.warn(`[proxy:health-check] unexpected error checking "${proxy.name}"`, err);
      }
    }
  }
}
