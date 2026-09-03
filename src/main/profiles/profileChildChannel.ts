import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import type { CookieInfo, CookieSetInput } from '../../shared/schemas/cookie';
import type { LocalStorageEntry, LocalStorageListResponse, LocalStorageSetInput } from '../../shared/schemas/localStorageEntry';

/**
 * Everything that talks to a running profile's child process over its
 * existing stdio IPC channel: the cookie/localStorage request/response
 * protocol (sendChildRequest, with its retry-until-listening behavior — see
 * that method's own comment for the real, reproduced race it covers) and the
 * automation-proxy one-shot readiness notification (see waitForAutomationReady).
 *
 * Extracted out of ProfileManager, which was accumulating responsibilities
 * beyond process lifecycle (spawn/stop/lock/DB-status/bulk-ops) — this class
 * owns none of that, only the message-passing protocol once a child process
 * already exists. ProfileManager still owns the `running` map (which id has
 * which ChildProcess) and passes the relevant child into each call here,
 * rather than this class tracking process lifecycle itself.
 */
export class ProfileChildChannel {
  /** Whether each running profile's automation proxy has actually finished
   * binding — see waitForAutomationReady() for why this can't just be
   * inferred from profile.status === 'RUNNING'. */
  private readonly automationProxyState = new Map<string, 'ready' | { error: string }>();
  private readonly automationProxyWaiters = new Map<
    string,
    Array<{ resolve: () => void; reject: (err: Error) => void }>
  >();

  constructor(private readonly logs: ActivityLogRepository) {}

  /** Called from ProfileManager.start() right after spawning — starts
   * tracking automation-proxy readiness for `id` from the moment the child
   * process exists, so a call to waitForAutomationReady() before or after
   * the child's own automation-proxy:ready message arrives both resolve
   * correctly (see that method's own comment). */
  registerChild(id: string, child: ChildProcess): void {
    this.automationProxyState.delete(id);
    child.on('message', (raw) => {
      const msg = raw as { type?: string; error?: string };
      if (msg?.type === 'automation-proxy:ready') {
        this.automationProxyState.set(id, 'ready');
        const waiters = this.automationProxyWaiters.get(id) ?? [];
        this.automationProxyWaiters.delete(id);
        waiters.forEach((w) => w.resolve());
      } else if (msg?.type === 'automation-proxy:error') {
        const state = { error: msg.error ?? 'Automation proxy failed to start' };
        this.automationProxyState.set(id, state);
        const waiters = this.automationProxyWaiters.get(id) ?? [];
        this.automationProxyWaiters.delete(id);
        waiters.forEach((w) => w.reject(new Error(state.error)));
      }
    });
  }

  /** Called from ProfileManager's child 'exit' handler — clears cached
   * readiness state and rejects anyone still waiting, since the profile
   * (and any chance of it becoming ready) is gone. */
  unregisterChild(id: string): void {
    this.automationProxyState.delete(id);
    const waiters = this.automationProxyWaiters.get(id);
    if (waiters) {
      this.automationProxyWaiters.delete(id);
      waiters.forEach((w) => w.reject(new Error('Profile stopped before its automation proxy became ready')));
    }
  }

  /** Waits for confirmation that the profile's automation proxy has actually
   * bound its external port — not just that profile.status says RUNNING,
   * which ProfileManager.start() sets synchronously right at spawn(), long
   * before the child's own app.whenReady() (let alone startAutomationProxy()'s
   * listen() callback within it) has fired. Same race class sendChildRequest
   * already retries around for cookies/localStorage, confirmed real here too
   * by automationApi.spec.ts's own comment about needing an artificial delay
   * before hitting the port right after seeing RUNNING. Unlike
   * sendChildRequest this is one-directional (the child was never asked
   * anything, so there's nothing to re-send) — the child reports readiness
   * exactly once, and this either returns the already-cached result or waits
   * (bounded by timeoutMs) for that one message to arrive, rather than a
   * caller doing a single synchronous check that could land on either side
   * of it. `isRunning` is passed in rather than looked up here since this
   * class doesn't own the `running` map. */
  waitForAutomationReady(id: string, isRunning: boolean, timeoutMs = 10_000): Promise<void> {
    const state = this.automationProxyState.get(id);
    if (state === 'ready') return Promise.resolve();
    if (state && typeof state === 'object') return Promise.reject(new Error(state.error));
    if (!isRunning) return Promise.reject(new Error('Profile is not running'));

    return new Promise<void>((resolve, reject) => {
      const entry = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(timer);
          reject(err);
        },
      };
      const timer = setTimeout(() => {
        const list = this.automationProxyWaiters.get(id);
        if (list) {
          const idx = list.indexOf(entry);
          if (idx >= 0) list.splice(idx, 1);
        }
        reject(new Error('Automation proxy did not become ready in time'));
      }, timeoutMs);
      const waiters = this.automationProxyWaiters.get(id) ?? [];
      waiters.push(entry);
      this.automationProxyWaiters.set(id, waiters);
    });
  }

  /** Cookies live inside a running profile's own child-process session
   * (session.fromPartition(...) — see profileWindowEntry.ts), never
   * persisted anywhere the manager process can read directly. This sends a
   * typed request over the existing stdio IPC channel (already used for
   * graceful-quit) and correlates the reply by requestId, so multiple
   * concurrent cookie requests to the same profile can't cross-resolve.
   * `child` is undefined (or channel-less) when the profile isn't running —
   * there is no session to ask otherwise.
   *
   * Retries the same request (same requestId, so a late reply to an
   * earlier attempt still resolves it correctly) roughly once a second
   * instead of sending once and only waiting: a profile freshly marked
   * RUNNING (which happens the moment the OS process is spawned — see
   * ProfileManager.start()) can still be seconds away from Electron's
   * whenReady() actually resolving in that child and this manager-side
   * listener being attached on its end, so a single send can genuinely land
   * before anything there is listening yet. Found via a real, reproducible
   * E2E failure (the very first cookie request right after a profile
   * reports RUNNING routinely timed out; a few seconds' artificial delay in
   * the test made it pass every time) — not a hypothetical race. All
   * request types this method serves (cookies/localStorage list/remove/set)
   * are naturally idempotent, so re-sending is safe. */
  private sendChildRequest<T>(
    child: ChildProcess | undefined,
    message: Record<string, unknown>,
    timeoutMs = 5_000,
  ): Promise<T> {
    if (!child || !child.channel) {
      throw new Error('Start the profile before viewing or editing its cookies');
    }
    // TS can't carry the above narrowing into the closures declared below
    // (they could theoretically be invoked at any later, disconnected
    // time), so this const re-binds it as definitely-ChildProcess for the
    // rest of the method.
    const readyChild = child;
    const requestId = randomUUID();
    const retryIntervalMs = 1_000;
    const maxAttempts = Math.max(1, Math.round(timeoutMs / retryIntervalMs));

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let retryTimer: NodeJS.Timeout;

      function cleanup(): void {
        settled = true;
        clearTimeout(retryTimer);
        readyChild.off('message', onMessage);
      }

      function onMessage(raw: unknown): void {
        if (settled) return;
        const msg = raw as { requestId?: string; type?: string; error?: string };
        if (msg?.requestId !== requestId) return;
        cleanup();
        // Generic — covers cookies:error, localStorage:error, and any future
        // *:error type this same request/response protocol grows to carry.
        if (msg.type?.endsWith(':error')) reject(new Error(msg.error ?? 'Request failed'));
        else resolve(msg as T);
      }

      let attempts = 0;
      function attempt(): void {
        if (settled) return;
        attempts++;
        readyChild.send({ ...message, requestId });
        retryTimer = setTimeout(() => {
          if (settled) return;
          if (attempts >= maxAttempts) {
            cleanup();
            reject(new Error('Profile did not respond in time'));
          } else {
            attempt();
          }
        }, retryIntervalMs);
      }

      readyChild.on('message', onMessage);
      attempt();
    });
  }

  async listCookies(child: ChildProcess | undefined): Promise<CookieInfo[]> {
    const result = await this.sendChildRequest<{ cookies: CookieInfo[] }>(child, { type: 'cookies:list' });
    return result.cookies;
  }

  async removeCookie(child: ChildProcess | undefined, id: string, params: { url: string; name: string }): Promise<void> {
    await this.sendChildRequest(child, { type: 'cookies:remove', url: params.url, name: params.name });
    this.logs.record('PROFILE_UPDATED', id, `Cookie "${params.name}" removed`);
  }

  async setCookie(child: ChildProcess | undefined, id: string, cookie: CookieSetInput): Promise<void> {
    await this.sendChildRequest(child, { type: 'cookies:set', cookie });
    this.logs.record('PROFILE_UPDATED', id, `Cookie "${cookie.name}" set on ${cookie.url}`);
  }

  /** Unlike cookies, localStorage is per-origin/per-tab — see
   * profileWindowEntry.ts's localStorage: handlers for what "which tab"
   * actually resolves to. */
  async listLocalStorage(child: ChildProcess | undefined): Promise<LocalStorageListResponse> {
    const result = await this.sendChildRequest<{ origin: string; items: LocalStorageEntry[] }>(child, {
      type: 'localStorage:list',
    });
    return { origin: result.origin, items: result.items };
  }

  async setLocalStorageItem(child: ChildProcess | undefined, id: string, input: LocalStorageSetInput): Promise<void> {
    await this.sendChildRequest(child, { type: 'localStorage:set', key: input.key, value: input.value });
    this.logs.record('PROFILE_UPDATED', id, `localStorage key "${input.key}" set`);
  }

  async removeLocalStorageItem(child: ChildProcess | undefined, id: string, key: string): Promise<void> {
    await this.sendChildRequest(child, { type: 'localStorage:remove', key });
    this.logs.record('PROFILE_UPDATED', id, `localStorage key "${key}" removed`);
  }
}
