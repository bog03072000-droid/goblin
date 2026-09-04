import type { ProfileRepository } from '../database/profileRepository';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import { deleteProfileStorage, resolveProfileDir } from '../storage/profileStorage';
import type { Profile } from '../../shared/schemas/profile';
import type { BulkResult } from './bulkResult';

/** How long a soft-deleted profile stays recoverable via restoreDeleted()
 * before being permanently removed. Overridable for tests only (see the
 * PF_E2E_/PF_SOFT_DELETE_WINDOW_MS convention) — never meant to be
 * end-user configurable. */
const SOFT_DELETE_WINDOW_MS = Number(process.env['PF_SOFT_DELETE_WINDOW_MS'] ?? 30_000);

/**
 * Soft-delete + undo-window lifecycle for profiles: delete() marks a
 * profile deleted immediately (disappears from the default list) but keeps
 * it fully recoverable via restoreDeleted() until SOFT_DELETE_WINDOW_MS
 * elapses, at which point it's permanently removed (DB row and on-disk
 * storage both) in the background.
 *
 * Extracted out of ProfileManager for the same reason ProfileChildChannel
 * was: that class was accumulating responsibilities beyond core process
 * lifecycle (spawn/stop/lock/DB-status/bulk-ops) — this one owns none of
 * that, only the soft-delete/undo/hard-delete state machine. ProfileManager
 * still owns the `running` map (a soft-delete must not touch a running
 * profile), and passes an `isRunning` check into the constructor rather
 * than this class tracking process state itself.
 */
export class ProfileLifecycleManager {
  private readonly pendingHardDeletes = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly profilesRoot: string,
    private readonly profiles: ProfileRepository,
    private readonly logs: ActivityLogRepository,
    private readonly isRunning: (id: string) => boolean,
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

  /** Soft-deletes: the profile disappears from the default list immediately
   * and stays fully recoverable via restoreDeleted() for SOFT_DELETE_WINDOW_MS,
   * after which it's permanently removed (files included) in the background —
   * same end state the old hard-delete-on-click behavior produced, just with
   * an undo window in front of it. */
  delete(id: string): void {
    const profile = this.mustGet(id);
    if (this.isRunning(id)) throw new Error('Stop the profile before deleting it');
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

  /** Same sequential-with-yield shape as ProfileManager's own bulkRun (each
   * id's outcome reported independently, one failure never aborts the rest)
   * — kept as its own small copy here rather than a cross-class private-
   * method dependency, so this class stays self-contained and independently
   * testable, matching why it was split out of ProfileManager in the first
   * place. */
  private async bulkRun(ids: string[], action: (id: string) => void): Promise<BulkResult> {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      try {
        action(id);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, message: err instanceof Error ? err.message : String(err) });
      }
      if (i % 20 === 19) await new Promise((resolve) => setImmediate(resolve));
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

  private hardDeletePermanently(id: string): void {
    const profile = this.profiles.getById(id);
    deleteProfileStorage(this.profilesRoot, id);
    this.profiles.hardDelete(id);
    if (profile) {
      this.logs.record('PROFILE_DELETED', id, `Profile "${profile.name}" permanently removed`);
    }
  }

  private mustGet(id: string): Profile {
    const profile = this.profiles.getById(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    // Guard against forged storage paths pointing outside the managed root.
    resolveProfileDir(this.profilesRoot, id);
    return profile;
  }
}
