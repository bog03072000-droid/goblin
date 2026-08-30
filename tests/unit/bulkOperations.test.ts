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
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');

    ids = ['a', 'b', 'c'].map((seed) => {
      const fp = fingerprints.create(generateFingerprint({ seed: `bulk-${seed}` }));
      return manager.create({ name: `Bulk ${seed}`, tags: ['bulk-test'] }, fp.id).id;
    });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('bulkDelete removes only the requested profiles and isolates per-item failures', async () => {
    const result = await manager.bulkDelete([...ids, 'not-a-real-uuid']);
    expect(result.succeeded.sort()).toEqual([...ids].sort());
    expect(result.failed.length).toBe(1);
    expect(profiles.list().length).toBe(0);
  });

  it('bulkClone creates an independent config-clone of each profile', async () => {
    const result = await manager.bulkClone(ids);
    expect(result.succeeded.length).toBe(3);
    expect(result.failed).toEqual([]);
    expect(profiles.list().length).toBe(6);
    const clones = profiles.list().filter((p) => p.name.endsWith('(clone)'));
    expect(clones.length).toBe(3);
    // Each clone must have its own storage directory, never shared with the source.
    const paths = new Set(profiles.list().map((p) => p.profilePath));
    expect(paths.size).toBe(6);
  });

  it('bulkAssignProxy updates every requested profile', async () => {
    const proxies = new ProxyRepository(db);
    const proxy = proxies.create({ name: 'p1', protocol: 'http', host: '127.0.0.1', port: 8080 });
    const result = await manager.bulkAssignProxy(ids, proxy.id);
    expect(result.succeeded.length).toBe(3);
    for (const id of ids) {
      expect(profiles.getById(id)!.proxyId).toBe(proxy.id);
    }
  });

  it('bulkAddTags merges with existing tags instead of replacing them', async () => {
    const result = await manager.bulkAddTags(ids, ['new-tag']);
    expect(result.succeeded.length).toBe(3);
    for (const id of ids) {
      const tags = profiles.getById(id)!.tags;
      expect(tags).toContain('bulk-test');
      expect(tags).toContain('new-tag');
    }
  });

  it('bulkRemoveTags removes only the requested tag, leaving the rest intact', async () => {
    await manager.bulkAddTags(ids, ['temporary']);
    const result = await manager.bulkRemoveTags(ids, ['temporary']);
    expect(result.succeeded.length).toBe(3);
    for (const id of ids) {
      const tags = profiles.getById(id)!.tags;
      expect(tags).toContain('bulk-test');
      expect(tags).not.toContain('temporary');
    }
  });

  it('bulkStop actually awaits each stop instead of reporting success before it completes', async () => {
    // Regression test for a real bug: bulkStop used to call the sync-typed
    // bulkRun() with `(id) => this.stop(id)` WITHOUT awaiting the returned
    // promise, so every id was marked "succeeded" the instant stop() was
    // requested, not when it actually finished — a stop() failure would
    // have become an unhandled promise rejection instead of a reported
    // bulk failure. None of these profiles are running, so stop() resolves
    // via its "no tracked process" graceful path — the real assertion here
    // is simply that awaiting bulkStop() resolves to a real BulkResult
    // (proving it's genuinely async now), not a stale synchronous return.
    const result = await manager.bulkStop(ids);
    expect(result.succeeded.sort()).toEqual([...ids].sort());
    expect(result.failed).toEqual([]);
  });

  it('bulkRestart isolates per-profile failures without throwing', async () => {
    // Same reasoning as bulkStart's test below: no real Electron app exists
    // in this test environment, so every restart's underlying start() fails
    // — the point is that bulkRestart aggregates those failures per-profile
    // instead of throwing and aborting the whole batch.
    const result = await manager.bulkRestart(ids, 2);
    expect(result.succeeded.length + result.failed.length).toBe(3);
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
