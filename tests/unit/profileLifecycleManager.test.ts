import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { createProfileStorage } from '../../src/main/storage/profileStorage';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

// ProfileLifecycleManager reads SOFT_DELETE_WINDOW_MS from this env var once,
// at module load time — set small here so these tests don't need to wait a
// real 30s for the background hard-delete to fire.
process.env['PF_SOFT_DELETE_WINDOW_MS'] = '30';

const { ProfileLifecycleManager } = await import('../../src/main/profiles/profileLifecycleManager');

const migrationsDir = path.join(__dirname, '../../database/migrations');

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tested standalone here, without ProfileManager at all — same rationale
 * as profileChildChannel.test.ts: the soft-delete/undo/hard-delete state
 * machine has no dependency on process lifecycle, lock files, or a real
 * running-profile map, and this file proves that by never constructing a
 * ProfileManager or touching a child process. `isRunning` is a plain
 * closure over a mutable set the tests control directly, not a real
 * process-tracking map. */
describe('ProfileLifecycleManager', () => {
  let db: Database.Database;
  let root: string;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;
  let runningIds: Set<string>;
  let lifecycle: InstanceType<typeof ProfileLifecycleManager>;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-lifecycle-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    const logs = new ActivityLogRepository(db);
    runningIds = new Set();
    lifecycle = new ProfileLifecycleManager(root, profiles, logs, (id) => runningIds.has(id));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeProfile(name: string) {
    const fp = fingerprints.create(generateFingerprint({ seed: name }));
    const created = profiles.create({
      name,
      description: '',
      profilePath: '__pending__',
      fingerprintId: fp.id,
      proxyId: null,
      groupId: null,
      tags: [],
    });
    const dir = createProfileStorage(root, created.id);
    profiles.setProfilePath(created.id, dir);
    return profiles.getById(created.id)!;
  }

  it('delete() soft-deletes: the profile leaves the default list immediately but its row and files survive', () => {
    const profile = makeProfile('Soft Deleted');
    lifecycle.delete(profile.id);

    expect(profiles.list().map((p) => p.id)).not.toContain(profile.id);
    expect(profiles.getById(profile.id)).not.toBeNull();
    expect(fs.existsSync(profile.profilePath)).toBe(true);
  });

  it('restoreDeleted() within the undo window brings the profile back and cancels the pending hard-delete', async () => {
    const profile = makeProfile('Undone Delete');
    lifecycle.delete(profile.id);
    expect(profiles.list().map((p) => p.id)).not.toContain(profile.id);

    lifecycle.restoreDeleted(profile.id);
    expect(profiles.list().map((p) => p.id)).toContain(profile.id);

    await wait(80);
    expect(profiles.getById(profile.id)).not.toBeNull();
    expect(fs.existsSync(profile.profilePath)).toBe(true);
  });

  it('once the undo window elapses, the profile and its on-disk storage are permanently removed', async () => {
    const profile = makeProfile('Expired Delete');
    const profilePath = profile.profilePath;
    lifecycle.delete(profile.id);

    await wait(80);

    expect(profiles.getById(profile.id)).toBeNull();
    expect(fs.existsSync(profilePath)).toBe(false);
  });

  it('restoreDeleted() after the undo window already elapsed throws — nothing left to restore', async () => {
    const profile = makeProfile('Too Late');
    lifecycle.delete(profile.id);
    await wait(80);

    expect(() => lifecycle.restoreDeleted(profile.id)).toThrow();
  });

  it('bulkDelete() soft-deletes all, bulkRestoreDeleted() brings them all back', async () => {
    const a = makeProfile('Bulk A');
    const b = makeProfile('Bulk B');
    await lifecycle.bulkDelete([a.id, b.id]);
    expect(profiles.list().map((p) => p.id)).not.toContain(a.id);
    expect(profiles.list().map((p) => p.id)).not.toContain(b.id);

    const result = await lifecycle.bulkRestoreDeleted([a.id, b.id]);
    expect(result.succeeded.sort()).toEqual([a.id, b.id].sort());
    const ids = profiles.list().map((p) => p.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('a running profile cannot be deleted (the isRunning callback is consulted, not a real process map)', () => {
    const profile = makeProfile('Running Guard');
    runningIds.add(profile.id);

    expect(() => lifecycle.delete(profile.id)).toThrow('Stop the profile before deleting it');
    expect(profiles.list().map((p) => p.id)).toContain(profile.id);
  });

  it('the constructor itself hard-deletes any profile whose undo window already elapsed while nothing was running (defensive startup cleanup)', () => {
    const profile = makeProfile('Stale From Last Run');
    const profilePath = profile.profilePath;
    profiles.softDelete(profile.id);
    // Backdate deleted_at so this row looks like it was soft-deleted well
    // before a fresh PF_SOFT_DELETE_WINDOW_MS=30ms window — simulating "the
    // app was closed mid-undo-window and just restarted", which the timer
    // approach alone can't cover since in-memory timers don't survive a
    // restart.
    db.prepare('UPDATE profiles SET deleted_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', profile.id);

    const logs = new ActivityLogRepository(db);
    new ProfileLifecycleManager(root, profiles, logs, () => false);

    expect(profiles.getById(profile.id)).toBeNull();
    expect(fs.existsSync(profilePath)).toBe(false);
  });
});
