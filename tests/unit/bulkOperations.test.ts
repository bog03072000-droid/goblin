import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { ProfileManager } from '../../src/main/profiles/profileManager';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ProfileManager bulk operations', () => {
  let db: Database.Database;
  let root: string;
  let manager: ProfileManager;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;
  let ids: string[];

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bulk-ops-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs);

    ids = ['a', 'b', 'c'].map((seed) => {
      const fp = fingerprints.create(generateFingerprint({ seed: `bulk-${seed}` }));
      return manager.create({ name: `Bulk ${seed}`, tags: ['bulk-test'] }, fp.id).id;
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('bulkDelete removes only the requested profiles and isolates per-item failures', () => {
    const result = manager.bulkDelete([...ids, 'not-a-real-uuid']);
    expect(result.succeeded.sort()).toEqual([...ids].sort());
    expect(result.failed.length).toBe(1);
    expect(profiles.list().length).toBe(0);
  });

  it('bulkClone creates an independent config-clone of each profile', () => {
    const result = manager.bulkClone(ids);
    expect(result.succeeded.length).toBe(3);
    expect(result.failed).toEqual([]);
    expect(profiles.list().length).toBe(6);
    const clones = profiles.list().filter((p) => p.name.endsWith('(clone)'));
    expect(clones.length).toBe(3);
    // Each clone must have its own storage directory, never shared with the source.
    const paths = new Set(profiles.list().map((p) => p.profilePath));
    expect(paths.size).toBe(6);
  });

  it('bulkAssignProxy updates every requested profile', () => {
    const proxies = new ProxyRepository(db);
    const proxy = proxies.create({ name: 'p1', protocol: 'http', host: '127.0.0.1', port: 8080 });
    const result = manager.bulkAssignProxy(ids, proxy.id);
    expect(result.succeeded.length).toBe(3);
    for (const id of ids) {
      expect(profiles.getById(id)!.proxyId).toBe(proxy.id);
    }
  });

  it('bulkAddTags merges with existing tags instead of replacing them', () => {
    const result = manager.bulkAddTags(ids, ['new-tag']);
    expect(result.succeeded.length).toBe(3);
    for (const id of ids) {
      const tags = profiles.getById(id)!.tags;
      expect(tags).toContain('bulk-test');
      expect(tags).toContain('new-tag');
    }
  });

  it('bulkStart isolates per-profile launch failures without throwing', async () => {
    // In this test environment there's no real Electron app to spawn a child
    // process against, so every launch is expected to fail — the point of
    // this test is that bulkStart aggregates those failures instead of
    // throwing and aborting the whole batch.
    const result = await manager.bulkStart(ids, 2);
    expect(result.succeeded.length + result.failed.length).toBe(3);
    expect(result.failed.length).toBeGreaterThan(0);
  });
});
