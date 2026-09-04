import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ProfileRepository } from '../database/profileRepository';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import type { ProxyRepository } from '../database/proxyRepository';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import type { GroupRepository } from '../database/groupRepository';
import { log } from '../logger';
import { LockManager } from './lockManager';
import { ProfileChildChannel } from './profileChildChannel';
import { ProfileLifecycleManager } from './profileLifecycleManager';
import type { BulkResult } from './bulkResult';
import { launchProfileProcess } from '../browser/browserLauncher';
import { checkBrowserCompatibility } from '../fingerprint/browserCompatibility';
import {
  createProfileStorage,
  clearProfileCache,
  copyProfileStorage,
  resolveProfileDir,
} from '../storage/profileStorage';
import type { Profile, ProfileCreateInput } from '../../shared/schemas/profile';
import type { CookieInfo, CookieSetInput } from '../../shared/schemas/cookie';
import type { LocalStorageListResponse, LocalStorageSetInput } from '../../shared/schemas/localStorageEntry';

export type { BulkResult } from './bulkResult';

/**
 * Orchestrates the full profile lifecycle: DB state + on-disk storage + OS
 * process + lock file all move together so they never drift out of sync.
 */
export class ProfileManager {
  private readonly running = new Map<string, ChildProcess>();
  private readonly lockManager = new LockManager();
  /** ids with a stop() currently in flight — lets the exit handler tell a
   * requested stop apart from a genuinely unexpected crash. See stop(). */
  private readonly stopping = new Set<string>();
  /** Cookie/localStorage IPC protocol + automation-proxy readiness — see
   * ProfileChildChannel's own doc comment for why this is a separate class
   * rather than more ProfileManager methods. */
  private readonly childChannel: ProfileChildChannel;
  /** Soft-delete/undo/hard-delete state machine — see
   * ProfileLifecycleManager's own doc comment for why this is a separate
   * class rather than more ProfileManager methods. */
  private readonly lifecycle: ProfileLifecycleManager;

  constructor(
    private readonly profilesRoot: string,
    private readonly profiles: ProfileRepository,
    private readonly fingerprints: FingerprintRepository,
    private readonly proxies: ProxyRepository,
    private readonly logs: ActivityLogRepository,
    private readonly dbPath: string,
    /** Optional: only proxy rotation (see start()) depends on this. Existing
     * callers/tests that don't care about rotation can omit it entirely —
     * a profile with no direct proxy assignment just runs unproxied, same
     * as before this existed. */
    private readonly groups?: GroupRepository,
  ) {
    this.childChannel = new ProfileChildChannel(this.logs);
    this.lifecycle = new ProfileLifecycleManager(this.profilesRoot, this.profiles, this.logs, (id) => this.running.has(id));
  }

  create(input: ProfileCreateInput, fingerprintId: string): Profile {
    // profilePath is computed here, server-side, from a freshly generated ID —
    // never accepted from the caller — so it cannot be used for path traversal.
    const tempProfile = this.profiles.create({
      name: input.name,
      description: input.description,
      profilePath: '__pending__',
      fingerprintId,
      proxyId: input.proxyId ?? null,
      groupId: input.groupId ?? null,
      tags: input.tags,
    });
    const dir = createProfileStorage(this.profilesRoot, tempProfile.id);
    this.profiles.setProfilePath(tempProfile.id, dir);
    this.logs.record('PROFILE_CREATED', tempProfile.id, `Profile "${input.name}" created`);
    return this.profiles.getById(tempProfile.id)!;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  /** `initialUrl` is used by the Downloads page's "Re-download" action: it
   * launches the profile navigating straight at the original download URL
   * instead of the normal start page, so Electron's `will-download` fires
   * again naturally when that URL serves a file. Only usable when the
   * profile isn't already running — there is no back-channel into an
   * already-running profile's separate OS process to redirect it. */
  start(id: string, opts?: { initialUrl?: string }): Profile {
    const profile = this.mustGet(id);
    if (profile.status === 'RUNNING' || this.running.has(id)) {
      throw new Error('Profile is already running');
    }
    // The directory can go missing if it was moved/deleted outside the app
    // (e.g. by hand, an antivirus quarantine, or a failed backup restore).
    // Without this check, Chromium would silently create a brand-new empty
    // one under the same path — a surprising, silent data-loss path — so
    // this surfaces it as a clear error instead.
    if (!fs.existsSync(profile.profilePath)) {
      this.profiles.updateStatus(id, 'ERROR');
      throw new Error('Profile storage directory is missing');
    }
    const browserDataDir = path.join(profile.profilePath, 'browser-data');
    if (this.lockManager.isLocked(profile.profilePath)) {
      throw new Error('Profile is locked by another running instance');
    }

    const fingerprint = this.fingerprints.getById(profile.fingerprintId);
    if (!fingerprint) throw new Error('Profile fingerprint is missing');

    // Rotation only ever applies when the profile itself has NO directly
    // assigned proxy — an explicit per-profile assignment always wins and is
    // never second-guessed by a group's pool. Picked fresh on every start(),
    // not persisted onto the profile, so restarting a profile can genuinely
    // rotate it to the next proxy in the pool rather than sticking forever.
    let effectiveProxyId = profile.proxyId;
    if (!effectiveProxyId && profile.groupId && this.groups) {
      const picked = this.groups.pickNextPoolProxy(profile.groupId);
      if (picked) {
        effectiveProxyId = picked;
        this.logs.record(
          'PROXY_ASSIGNED',
          id,
          `Rotation pool assigned proxy for this session (profile has no fixed proxy)`,
        );
      }
    }
    const proxy = effectiveProxyId ? this.proxies.getById(effectiveProxyId) : null;
    const proxyPassword = effectiveProxyId ? this.proxies.getPassword(effectiveProxyId) : null;

    // getAutomationToken() returns null if automation was never enabled for
    // this profile (no token generated yet) — automationEnabled alone
    // without a token can't happen through the normal update() flow (see
    // registerIpc.ts's regenerateAutomationToken), but this stays a safe
    // no-automation fallback either way rather than launching with a port
    // and no way to authenticate against it.
    const automationToken = profile.automationEnabled ? this.profiles.getAutomationToken(id) : null;

    // Guards against exactly the drift the fingerprint audit found: an
    // Electron/Chromium upgrade silently making an old profile's claimed
    // browser version wrong. Never blocks the launch — just surfaces it.
    const compat = checkBrowserCompatibility(fingerprint.browserVersion, process.versions.chrome);
    if (!compat.compatible && compat.message) {
      this.logs.record('FINGERPRINT_CHANGED', id, compat.message);
    }

    this.profiles.updateStatus(id, 'STARTING');
    let child: ChildProcess;
    try {
      child = launchProfileProcess({
        profileId: id,
        profileName: profile.name,
        userDataDir: browserDataDir,
        fingerprint,
        proxy,
        proxyPassword,
        dbPath: this.dbPath,
        initialUrl: opts?.initialUrl,
        automationPort: profile.automationEnabled ? profile.automationPort : null,
        automationToken,
      });
    } catch (err) {
      this.profiles.updateStatus(id, 'ERROR');
      log.error(`[profile:start] failed to launch process for profile ${id}`, err);
      throw err;
    }

    this.lockManager.acquire(profile.profilePath, child.pid ?? -1);
    this.running.set(id, child);
    this.profiles.updateStatus(id, 'RUNNING');
    this.logs.record('PROFILE_STARTED', id, `Profile "${profile.name}" started (pid ${child.pid})`);
    log.info(`[profile:start] "${profile.name}" (${id}) started, pid ${child.pid}`);

    this.childChannel.registerChild(id, child);

    // A bad spawn (e.g. a missing/relocated Electron binary) usually fails
    // ASYNCHRONOUSLY via this event, not by throwing out of spawn() itself —
    // the try/catch above only catches the rarer synchronous failure case
    // (e.g. invalid arguments). Without this handler such a failure would
    // silently leave the profile stuck in STARTING forever.
    child.on('error', (err) => {
      this.running.delete(id);
      this.lockManager.release(profile.profilePath);
      this.profiles.updateStatus(id, 'ERROR');
      this.logs.record('PROFILE_CRASHED', id, `Failed to launch process for "${profile.name}": ${err.message}`);
      log.error(`[profile:start] child process error for profile ${id}`, err);
    });

    const startedAt = Date.now();
    child.on('exit', (code, signal) => {
      this.running.delete(id);
      this.lockManager.release(profile.profilePath);
      this.childChannel.unregisterChild(id);
      // A stop() the app itself requested is never a crash, no matter what
      // exit code the OS reports for it — root-caused via real repro (see
      // resourceManagement.spec.ts's history and the exit-code/signal log
      // this handler writes below): stopping a profile very soon after
      // starting it (e.g. restart() immediately followed by stop(), which
      // this app's own status flip to RUNNING happens synchronously on
      // spawn, before Chromium has actually finished booting, invites) can
      // make Windows report an abnormal exit code (observed: 0xFFFF7003,
      // i.e. -36861) for what is, from the user's perspective, an entirely
      // ordinary intentional stop — TerminateProcess/app.quit() racing a
      // still-initializing Chromium sub-process tree, not an application
      // fault. Treating any requested-stop exit as CRASHED regardless of
      // code alarmed users with a red status for something they explicitly
      // clicked. A genuine unexpected crash (this flag false) is still
      // graded on its exit code exactly as before.
      const requestedStop = this.stopping.has(id);
      const crashed = !requestedStop && code !== 0 && code !== null;
      this.profiles.updateStatus(id, crashed ? 'CRASHED' : 'STOPPED');
      const aliveMs = Date.now() - startedAt;
      const context = `code=${code} signal=${signal ?? 'null'} requestedStop=${requestedStop} aliveMs=${aliveMs}`;
      this.logs.record(
        crashed ? 'PROFILE_CRASHED' : 'PROFILE_STOPPED',
        id,
        `Profile "${profile.name}" exited (${context})`,
      );
      if (crashed) {
        log.warn(`[profile:crash] "${profile.name}" (${id}) exited unexpectedly: ${context}`);
      } else {
        log.info(`[profile:stop] "${profile.name}" (${id}) stopped: ${context}`);
      }
    });

    return this.mustGet(id);
  }

  /** Waits for the child's actual OS-level exit (not just for the kill signal
   * to be sent) before resolving — restart() below depends on this to avoid
   * racing a new start() against the old process's cleanup (which runs in
   * the 'exit' handler registered in start(): releasing this.running, the
   * lock file, and the DB status). Without this wait, start() would
   * immediately throw "already running"/"locked" against the not-yet-dead
   * old process. */
  async stop(id: string): Promise<Profile> {
    const profile = this.mustGet(id);
    this.profiles.updateStatus(id, 'STOPPING');
    const child = this.running.get(id);
    if (child) {
      this.stopping.add(id);
      try {
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          // A graceful `app.quit()` request first: on Windows, child.kill()
          // maps directly to TerminateProcess, which cuts the process off
          // mid-flight — Chromium's cookie/localStorage backing stores commit
          // to disk on a periodic/batched schedule, not synchronously on every
          // write, so a hard kill can silently lose whatever hadn't been
          // flushed yet (found via a real cross-restart cookie-persistence
          // test, not a hypothetical). `app.quit()` runs Electron/Chromium's
          // normal shutdown path, which flushes those stores first. Only if
          // the process doesn't exit on its own in time does this fall back
          // to the hard kill, so a genuinely hung process still gets torn down.
          if (child.channel) {
            child.send('graceful-quit');
            setTimeout(() => {
              if (this.running.get(id) === child) child.kill();
            }, 3_000).unref();
          } else {
            child.kill();
          }
        });
      } finally {
        this.stopping.delete(id);
      }
    } else {
      // No tracked process (e.g. app restarted) — just clear stale DB/lock state.
      this.lockManager.release(profile.profilePath);
      this.profiles.updateStatus(id, 'STOPPED');
      this.logs.record('PROFILE_STOPPED', id, `Profile "${profile.name}" stopped (no tracked process)`);
    }
    return this.mustGet(id);
  }

  async restart(id: string): Promise<Profile> {
    if (this.running.has(id) || this.mustGet(id).status === 'RUNNING') {
      await this.stop(id);
    }
    return this.start(id);
  }

  clearCache(id: string): void {
    const profile = this.mustGet(id);
    if (this.running.has(id)) throw new Error('Stop the profile before clearing its cache');
    clearProfileCache(this.profilesRoot, id);
    this.logs.record('PROFILE_UPDATED', id, `Cache cleared for "${profile.name}"`);
  }

  /** Thin delegations to ProfileChildChannel — see that class for the
   * actual retry/protocol logic. This class's job here is only to resolve
   * `id` to the right ChildProcess (or `undefined`, which the channel
   * turns into "start the profile first"). */
  waitForAutomationReady(id: string, timeoutMs = 10_000): Promise<void> {
    return this.childChannel.waitForAutomationReady(id, this.running.has(id), timeoutMs);
  }

  listCookies(id: string): Promise<CookieInfo[]> {
    return this.childChannel.listCookies(this.running.get(id));
  }

  removeCookie(id: string, params: { url: string; name: string }): Promise<void> {
    return this.childChannel.removeCookie(this.running.get(id), id, params);
  }

  setCookie(id: string, cookie: CookieSetInput): Promise<void> {
    return this.childChannel.setCookie(this.running.get(id), id, cookie);
  }

  listLocalStorage(id: string): Promise<LocalStorageListResponse> {
    return this.childChannel.listLocalStorage(this.running.get(id));
  }

  setLocalStorageItem(id: string, input: LocalStorageSetInput): Promise<void> {
    return this.childChannel.setLocalStorageItem(this.running.get(id), id, input);
  }

  removeLocalStorageItem(id: string, key: string): Promise<void> {
    return this.childChannel.removeLocalStorageItem(this.running.get(id), id, key);
  }

  /** Thin delegations to ProfileLifecycleManager — see that class for the
   * actual soft-delete/undo/hard-delete logic. */
  delete(id: string): void {
    this.lifecycle.delete(id);
  }

  restoreDeleted(id: string): Profile {
    return this.lifecycle.restoreDeleted(id);
  }

  /** mode 'config' shares nothing but the fingerprint/proxy config; 'full' also
   * copies the persistent browser-data directory into a fresh, independent path. */
  clone(id: string, mode: 'config' | 'full', newName: string): Profile {
    const source = this.mustGet(id);
    const fingerprint = this.fingerprints.getById(source.fingerprintId);
    if (!fingerprint) throw new Error('Source fingerprint missing');
    const { id: _fpId, createdAt: _fpCreatedAt, updatedAt: _fpUpdatedAt, ...fingerprintInput } = fingerprint;
    const clonedFingerprint = this.fingerprints.create({
      ...fingerprintInput,
      seed: `${fingerprint.seed}-clone-${randomUUID()}`,
    });

    const created = this.create(
      {
        name: newName,
        description: source.description,
        proxyId: source.proxyId,
        groupId: source.groupId,
        tags: source.tags,
      },
      clonedFingerprint.id,
    );

    if (mode === 'full') {
      copyProfileStorage(this.profilesRoot, source.id, created.id);
    }
    this.logs.record('PROFILE_CLONED', created.id, `Cloned from "${source.name}" (mode: ${mode})`);
    return created;
  }

  /** Bulk actions never let one profile's failure abort the rest of the
   * batch; each id's outcome is reported independently. `action` may be
   * sync or async — `await`ing a plain (non-promise) return value is a
   * no-op, so this one implementation correctly handles both, which is
   * what fixed a real bug: bulkStop() used to call this with a sync-typed
   * callback around `this.stop(id)` (which returns a Promise) WITHOUT
   * awaiting it, so every stop was reported "succeeded" the instant it was
   * *requested*, not when it actually finished — any real failure became
   * an unhandled promise rejection instead of a reported bulk failure. */
  private async bulkRun(ids: string[], action: (id: string) => void | Promise<void>): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        await action(id);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, message: err instanceof Error ? err.message : String(err) });
      }
      // Yields to the event loop every 20 items so a large batch (e.g. 200
      // profiles) never blocks the single-threaded main process — and
      // therefore all other IPC handling — for one long synchronous stretch.
      if (i % 20 === 19) await new Promise((resolve) => setImmediate(resolve));
    }
    return { succeeded, failed };
  }

  /** Runs `action` over `ids` in small chunks of `concurrency`, pausing
   * 250ms between chunks — shared by bulkStart/bulkRestart so bulk-launching
   * dozens of stored profiles never tries to spin up dozens of real Chromium
   * processes in the same instant. Was two nearly-identical copies of this
   * exact loop (one per caller) before being extracted here. */
  private async runChunked(
    ids: string[],
    concurrency: number,
    action: (id: string) => void | Promise<void>,
  ): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (let i = 0; i < ids.length; i += concurrency) {
      const chunk = ids.slice(i, i + concurrency);
      const result = await this.bulkRun(chunk, action);
      succeeded.push(...result.succeeded);
      failed.push(...result.failed);
      if (i + concurrency < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return { succeeded, failed };
  }

  bulkStart(ids: string[], concurrency = 4): Promise<BulkResult> {
    return this.runChunked(ids, concurrency, (id) => {
      this.start(id);
    });
  }

  bulkStop(ids: string[]): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => this.stop(id).then(() => undefined));
  }

  /** Same chunked-with-a-pause shape as bulkStart, for the same reason: a
   * restart re-launches a real Chromium process per profile. */
  bulkRestart(ids: string[], concurrency = 4): Promise<BulkResult> {
    return this.runChunked(ids, concurrency, (id) => this.restart(id).then(() => undefined));
  }

  bulkDelete(ids: string[]): Promise<BulkResult> {
    return this.lifecycle.bulkDelete(ids);
  }

  bulkRestoreDeleted(ids: string[]): Promise<BulkResult> {
    return this.lifecycle.bulkRestoreDeleted(ids);
  }

  bulkClone(ids: string[]): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => {
      const source = this.mustGet(id);
      this.clone(id, 'config', `${source.name} (clone)`);
    });
  }

  bulkAssignProxy(ids: string[], proxyId: string | null): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => {
      this.mustGet(id);
      this.profiles.update(id, { proxyId });
    });
  }

  bulkAssignGroup(ids: string[], groupId: string | null): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => {
      this.mustGet(id);
      this.profiles.update(id, { groupId });
    });
  }

  /** Adds tags without clobbering each profile's existing ones. */
  bulkAddTags(ids: string[], tags: string[]): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => {
      const profile = this.mustGet(id);
      const merged = Array.from(new Set([...profile.tags, ...tags]));
      this.profiles.update(id, { tags: merged });
    });
  }

  /** Removes tags without touching a profile's other, unrelated tags. */
  bulkRemoveTags(ids: string[], tags: string[]): Promise<BulkResult> {
    const toRemove = new Set(tags);
    return this.bulkRun(ids, (id) => {
      const profile = this.mustGet(id);
      const remaining = profile.tags.filter((tg) => !toRemove.has(tg));
      this.profiles.update(id, { tags: remaining });
    });
  }

  private mustGet(id: string): Profile {
    const profile = this.profiles.getById(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    // Guard against forged storage paths pointing outside the managed root.
    resolveProfileDir(this.profilesRoot, id);
    return profile;
  }
}
