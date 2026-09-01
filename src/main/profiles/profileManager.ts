import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ProfileRepository } from '../database/profileRepository';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import type { ProxyRepository } from '../database/proxyRepository';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import { log } from '../logger';
import { LockManager } from './lockManager';
import { launchProfileProcess } from '../browser/browserLauncher';
import { checkBrowserCompatibility } from '../fingerprint/browserCompatibility';
import {
  createProfileStorage,
  deleteProfileStorage,
  clearProfileCache,
  copyProfileStorage,
  resolveProfileDir,
} from '../storage/profileStorage';
import type { Profile, ProfileCreateInput } from '../../shared/schemas/profile';

export interface BulkResult {
  succeeded: string[];
  failed: Array<{ id: string; message: string }>;
}

/**
 * Orchestrates the full profile lifecycle: DB state + on-disk storage + OS
 * process + lock file all move together so they never drift out of sync.
 */
/** How long a soft-deleted profile stays recoverable via restoreDeleted()
 * before ProfileManager permanently removes it. Overridable for tests only
 * (see PF_E2E_* convention) — never meant to be end-user configurable. */
const SOFT_DELETE_WINDOW_MS = Number(process.env['PF_SOFT_DELETE_WINDOW_MS'] ?? 30_000);

export class ProfileManager {
  private readonly running = new Map<string, ChildProcess>();
  private readonly lockManager = new LockManager();
  private readonly pendingHardDeletes = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly profilesRoot: string,
    private readonly profiles: ProfileRepository,
    private readonly fingerprints: FingerprintRepository,
    private readonly proxies: ProxyRepository,
    private readonly logs: ActivityLogRepository,
    private readonly dbPath: string,
  ) {
    // Defensive cleanup for profiles whose undo window elapsed while the app
    // wasn't running to fire the in-memory timer (closed/crashed mid-window) —
    // without this they'd stay soft-deleted (invisible in the list, but still
    // on disk) forever.
    const cutoff = new Date(Date.now() - SOFT_DELETE_WINDOW_MS).toISOString();
    for (const { id } of this.profiles.listStaleDeleted(cutoff)) {
      this.hardDeletePermanently(id);
    }
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
    const proxy = profile.proxyId ? this.proxies.getById(profile.proxyId) : null;
    const proxyPassword = profile.proxyId ? this.proxies.getPassword(profile.proxyId) : null;

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

    child.on('exit', (code) => {
      this.running.delete(id);
      this.lockManager.release(profile.profilePath);
      const crashed = code !== 0 && code !== null;
      this.profiles.updateStatus(id, crashed ? 'CRASHED' : 'STOPPED');
      this.logs.record(
        crashed ? 'PROFILE_CRASHED' : 'PROFILE_STOPPED',
        id,
        `Profile "${profile.name}" exited with code ${code}`,
      );
      if (crashed) {
        log.warn(`[profile:crash] "${profile.name}" (${id}) exited with code ${code}`);
      } else {
        log.info(`[profile:stop] "${profile.name}" (${id}) stopped`);
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

  /** Soft-deletes: the profile disappears from the default list immediately
   * and stays fully recoverable via restoreDeleted() for SOFT_DELETE_WINDOW_MS,
   * after which it's permanently removed (files included) in the background —
   * same end state the old hard-delete-on-click behavior produced, just with
   * an undo window in front of it. */
  delete(id: string): void {
    const profile = this.mustGet(id);
    if (this.running.has(id)) throw new Error('Stop the profile before deleting it');
    this.profiles.softDelete(id);
    this.logs.record('PROFILE_DELETED', id, `Profile "${profile.name}" deleted`);
    const timer = setTimeout(() => {
      this.pendingHardDeletes.delete(id);
      this.hardDeletePermanently(id);
    }, SOFT_DELETE_WINDOW_MS);
    timer.unref();
    this.pendingHardDeletes.set(id, timer);
  }

  /** Reverses a pending delete() within its undo window. Throws if the window
   * already elapsed (and the profile was hard-deleted) or the id never
   * existed — nothing left to restore. */
  restoreDeleted(id: string): Profile {
    const timer = this.pendingHardDeletes.get(id);
    if (timer) {
      clearTimeout(timer);
      this.pendingHardDeletes.delete(id);
    }
    this.profiles.restoreDeleted(id);
    const profile = this.mustGet(id);
    this.logs.record('PROFILE_DELETE_UNDONE', id, `Deletion of "${profile.name}" undone`);
    return profile;
  }

  private hardDeletePermanently(id: string): void {
    const profile = this.profiles.getById(id);
    deleteProfileStorage(this.profilesRoot, id);
    this.profiles.hardDelete(id);
    if (profile) {
      this.logs.record('PROFILE_DELETED', id, `Profile "${profile.name}" permanently removed`);
    }
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

  /** Launches profiles in small chunks (never all at once) so bulk-starting
   * dozens of stored profiles doesn't try to spin up dozens of Chromium
   * processes in the same instant — stored profiles never need to run
   * simultaneously at scale, only a handful at a time in practice. */
  async bulkStart(ids: string[], concurrency = 4): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (let i = 0; i < ids.length; i += concurrency) {
      const chunk = ids.slice(i, i + concurrency);
      const result = await this.bulkRun(chunk, (id) => {
        this.start(id);
      });
      succeeded.push(...result.succeeded);
      failed.push(...result.failed);
      if (i + concurrency < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return { succeeded, failed };
  }

  bulkStop(ids: string[]): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => this.stop(id).then(() => undefined));
  }

  /** Same chunked-with-a-pause shape as bulkStart, for the same reason: a
   * restart re-launches a real Chromium process per profile. */
  async bulkRestart(ids: string[], concurrency = 4): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (let i = 0; i < ids.length; i += concurrency) {
      const chunk = ids.slice(i, i + concurrency);
      const result = await this.bulkRun(chunk, (id) => this.restart(id).then(() => undefined));
      succeeded.push(...result.succeeded);
      failed.push(...result.failed);
      if (i + concurrency < ids.length) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    return { succeeded, failed };
  }

  bulkDelete(ids: string[]): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => this.delete(id));
  }

  bulkRestoreDeleted(ids: string[]): Promise<BulkResult> {
    return this.bulkRun(ids, (id) => {
      this.restoreDeleted(id);
    });
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
