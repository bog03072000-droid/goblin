import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

// See profileManagerErrors.test.ts for why a bare EventEmitter with pid/kill
// is a faithful enough double for a real ChildProcess here.
class FakeChildProcess extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
}

vi.mock('../../src/main/browser/browserLauncher', () => ({
  launchProfileProcess: vi.fn(() => new FakeChildProcess()),
}));

// ProfileManager reads SOFT_DELETE_WINDOW_MS from this env var once, at
// module load time — set it small here so these tests don't need to wait a
// real 30s for the background hard-delete to fire.
process.env['PF_SOFT_DELETE_WINDOW_MS'] = '30';

const { ProfileManager } = await import('../../src/main/profiles/profileManager');

const migrationsDir = path.join(__dirname, '../../database/migrations');

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('ProfileManager soft-delete / undo / hard-delete-after-timeout', () => {
  let db: Database.Database;
  let root: string;
  let manager: InstanceType<typeof ProfileManager>;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-softdel-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeProfile(name: string) {
    const fp = fingerprints.create(generateFingerprint({ seed: name }));
    return manager.create({ name }, fp.id);
  }

  it('delete() soft-deletes: the profile leaves the default list immediately but its row and files survive', () => {
    const profile = makeProfile('Soft Deleted');
    manager.delete(profile.id);

    expect(profiles.list().map((p) => p.id)).not.toContain(profile.id);
    // getById() is an internal, unfiltered lookup — deliberately still finds
    // a soft-deleted row (restoreDeleted()/hardDeletePermanently() both rely
    // on this to find the profile by id after deleted_at is set).
    expect(profiles.getById(profile.id)).not.toBeNull();
    expect(fs.existsSync(profile.profilePath)).toBe(true);
  });

  it('restoreDeleted() within the undo window brings the profile back and cancels the pending hard-delete', async () => {
    const profile = makeProfile('Undone Delete');
    manager.delete(profile.id);
    expect(profiles.list().map((p) => p.id)).not.toContain(profile.id);

    manager.restoreDeleted(profile.id);
    expect(profiles.list().map((p) => p.id)).toContain(profile.id);

    // Wait past the (very short, test-only) undo window: if restoreDeleted()
    // had failed to cancel the scheduled hard-delete timer, the profile would
    // be wiped out from under us here.
    await wait(80);
    expect(profiles.getById(profile.id)).not.toBeNull();
    expect(fs.existsSync(profile.profilePath)).toBe(true);
  });

  it('once the undo window elapses, the profile and its on-disk storage are permanently removed', async () => {
    const profile = makeProfile('Expired Delete');
    const profilePath = profile.profilePath;
    manager.delete(profile.id);

    await wait(80);

    expect(profiles.getById(profile.id)).toBeNull();
    expect(fs.existsSync(profilePath)).toBe(false);
  });

  it('restoreDeleted() after the undo window already elapsed throws — nothing left to restore', async () => {
    const profile = makeProfile('Too Late');
    manager.delete(profile.id);
    await wait(80);

    expect(() => manager.restoreDeleted(profile.id)).toThrow();
  });

  it('bulkDelete() soft-deletes all, bulkRestoreDeleted() brings them all back', async () => {
    const a = makeProfile('Bulk A');
    const b = makeProfile('Bulk B');
    await manager.bulkDelete([a.id, b.id]);
    expect(profiles.list().map((p) => p.id)).not.toContain(a.id);
    expect(profiles.list().map((p) => p.id)).not.toContain(b.id);

    const result = await manager.bulkRestoreDeleted([a.id, b.id]);
    expect(result.succeeded.sort()).toEqual([a.id, b.id].sort());
    const ids = profiles.list().map((p) => p.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it('ProfileRepository.list({ includeDeleted: true }) still surfaces a soft-deleted row', () => {
    const profile = makeProfile('Include Deleted');
    profiles.softDelete(profile.id);
    expect(profiles.list().map((p) => p.id)).not.toContain(profile.id);
    expect(profiles.list({ includeDeleted: true }).map((p) => p.id)).toContain(profile.id);
  });

  it('ProfileRepository.listStaleDeleted() only returns rows deleted at or before the cutoff', () => {
    const stale = makeProfile('Stale');
    const fresh = makeProfile('Fresh');
    profiles.softDelete(stale.id);
    db.prepare('UPDATE profiles SET deleted_at = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', stale.id);
    profiles.softDelete(fresh.id); // deleted "now" — not stale relative to a past cutoff

    const staleIds = profiles.listStaleDeleted('2020-01-01T00:00:00.000Z').map((r) => r.id);
    expect(staleIds).toContain(stale.id);
    expect(staleIds).not.toContain(fresh.id);
  });

  it('a running profile cannot be deleted (soft-delete inherits the existing running-profile guard)', () => {
    (process.versions as Record<string, string>).chrome = '128.0.0.0';
    const profile = makeProfile('Running Guard');
    manager.start(profile.id);
    expect(() => manager.delete(profile.id)).toThrow('Stop the profile before deleting it');
    // Rejected before any soft-delete write — still fully visible in the list.
    expect(profiles.list().map((p) => p.id)).toContain(profile.id);
  });
});
