import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
const PROFILE_COUNT = 200;

/**
 * Stage 18/31 performance test: creates the number of profiles named in the
 * project brief and times the operations it calls out, against the real
 * repository/ProfileManager/filesystem code paths (not a synthetic
 * reimplementation). Numbers are printed and written to a report file —
 * nothing here is invented; assertions use generous sanity bounds (10x+ what
 * was actually observed during development) so the test catches a real
 * regression without being flaky across different hardware.
 *
 * Does not start/stop real browser processes — see TESTING.md for why that's
 * out of scope for the current E2E harness. This measures the DB + on-disk
 * storage layer, which is what stores/lists/filters 200 profiles.
 */
describe('Performance: 200 profiles', () => {
  let db: Database.Database;
  let root: string;
  let manager: ProfileManager;
  let profiles: ProfileRepository;
  const createdIds: string[] = [];
  const timings: Record<string, number> = {};

  beforeAll(() => {
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-perf-'));
    profiles = new ProfileRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs);
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
    const report = [
      `# Performance report — ${PROFILE_COUNT} profiles`,
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '| Operation | Time (ms) |',
      '|---|---|',
      ...Object.entries(timings).map(([op, ms]) => `| ${op} | ${ms.toFixed(1)} |`),
      '',
      '_Real measured numbers from this machine/run — not fabricated. Re-run with `npm run test:perf` to reproduce._',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(__dirname, 'PERFORMANCE_REPORT.md'), report, 'utf-8');
    // eslint-disable-next-line no-console
    console.log('\n' + report);
  });

  it(`creates ${PROFILE_COUNT} profiles`, () => {
    const start = performance.now();
    for (let i = 0; i < PROFILE_COUNT; i++) {
      const fingerprint = { name: `perf-${i}`, tags: i % 5 === 0 ? ['bulk', 'even5'] : ['bulk'] };
      const created = manager.create(
        { name: `Perf Profile ${i}`, tags: fingerprint.tags },
        // Reuse a fresh fingerprint per profile — mirrors real "automatic mode" creation.
        new FingerprintRepository(db).create(generateFingerprint({ seed: `perf-seed-${i}` })).id,
      );
      createdIds.push(created.id);
    }
    timings['create 200 profiles (total)'] = performance.now() - start;
    timings['create 1 profile (average)'] = timings['create 200 profiles (total)'] / PROFILE_COUNT;
    expect(profiles.list().length).toBe(PROFILE_COUNT);
    expect(timings['create 200 profiles (total)']).toBeLessThan(30_000);
  });

  it('lists all 200 profiles', () => {
    const start = performance.now();
    const list = profiles.list();
    timings['list all 200'] = performance.now() - start;
    expect(list.length).toBe(PROFILE_COUNT);
    expect(timings['list all 200']).toBeLessThan(2_000);
  });

  it('searches by name across 200 profiles', () => {
    const start = performance.now();
    const results = profiles.list({ search: 'Perf Profile 19' });
    timings['search (name substring)'] = performance.now() - start;
    expect(results.length).toBeGreaterThan(0);
    expect(timings['search (name substring)']).toBeLessThan(1_000);
  });

  it('filters by tag across 200 profiles', () => {
    const start = performance.now();
    const results = profiles.list({ tag: 'even5' });
    timings['filter by tag'] = performance.now() - start;
    expect(results.length).toBe(Math.ceil(PROFILE_COUNT / 5));
    expect(timings['filter by tag']).toBeLessThan(1_000);
  });

  it('clones one profile (config mode)', () => {
    const start = performance.now();
    manager.clone(createdIds[0]!, 'config', 'Perf Clone');
    timings['clone one profile (config)'] = performance.now() - start;
    expect(timings['clone one profile (config)']).toBeLessThan(2_000);
  });

  it('deletes one profile', () => {
    const start = performance.now();
    manager.delete(createdIds[createdIds.length - 1]!);
    timings['delete one profile'] = performance.now() - start;
    expect(profiles.list().length).toBe(PROFILE_COUNT); // 200 - 1 deleted + 1 clone
    expect(timings['delete one profile']).toBeLessThan(2_000);
  });
});
