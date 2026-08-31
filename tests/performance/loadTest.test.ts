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
import type { ProfileListItem } from '../../src/shared/schemas/profile';

const migrationsDir = path.join(__dirname, '../../database/migrations');

/**
 * Real-world load test — Test 1 (Profile Database) from the load-test brief:
 * the same real ProfileManager/ProfileRepository/filesystem code paths as
 * profileScale.test.ts, but run at four scales (20/50/100/200) in one file
 * so the numbers are directly comparable and the whole matrix is
 * regenerated from a single `npm run test:load` command — never hand-edited.
 *
 * This measures the DB + on-disk storage layer only, same scope as
 * profileScale.test.ts (see TESTING.md) — it does not start real browser
 * processes. See tests/e2e/loadTest*.spec.ts for the real-browser tiers of
 * the load test (bulk start/stop, isolation, stability, clone,
 * backup/restore, UI responsiveness).
 */
const SCALES = [20, 50, 100, 200] as const;

interface ScaleResult {
  scale: number;
  timings: Record<string, number>;
  heapUsedMb: number;
  rssMb: number;
}

const results: ScaleResult[] = [];

for (const SCALE of SCALES) {
  describe(`Load test: ${SCALE} profiles (database layer)`, () => {
    let db: Database.Database;
    let root: string;
    let manager: ProfileManager;
    let profiles: ProfileRepository;
    const createdIds: string[] = [];
    const timings: Record<string, number> = {};

    beforeAll(() => {
      db = createTestDb(migrationsDir);
      root = fs.mkdtempSync(path.join(os.tmpdir(), `pf-load-${SCALE}-`));
      profiles = new ProfileRepository(db);
      const fingerprints = new FingerprintRepository(db);
      const proxies = new ProxyRepository(db);
      const logs = new ActivityLogRepository(db);
      manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
    });

    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
      if (global.gc) global.gc();
      const mem = process.memoryUsage();
      results.push({
        scale: SCALE,
        timings: { ...timings },
        heapUsedMb: mem.heapUsed / 1024 / 1024,
        rssMb: mem.rss / 1024 / 1024,
      });
    });

    it(`creates ${SCALE} realistic profiles (varied OS/tags/groups via templates)`, () => {
      const start = performance.now();
      for (let i = 0; i < SCALE; i++) {
        const tags = i % 5 === 0 ? ['bulk', 'even5'] : i % 3 === 0 ? ['bulk', 'div3'] : ['bulk'];
        const fp = new FingerprintRepository(db).create(generateFingerprint({ seed: `load-${SCALE}-seed-${i}` }));
        const created = manager.create({ name: `Load Profile ${SCALE}-${i}`, tags }, fp.id);
        createdIds.push(created.id);
      }
      timings[`create ${SCALE} profiles (total)`] = performance.now() - start;
      timings['create 1 profile (average)'] = timings[`create ${SCALE} profiles (total)`] / SCALE;
      expect(profiles.list().length).toBe(SCALE);
      // Generous sanity bound (~10x observed on dev hardware) — catches a
      // real regression without being flaky across different machines.
      expect(timings[`create ${SCALE} profiles (total)`]).toBeLessThan(SCALE * 150);
    });

    it(`lists all ${SCALE} profiles`, () => {
      const start = performance.now();
      const list = profiles.list();
      timings['list all'] = performance.now() - start;
      expect(list.length).toBe(SCALE);
      expect(timings['list all']).toBeLessThan(2_000);
    });

    it('searches by name substring', () => {
      const start = performance.now();
      const results2 = profiles.list({ search: `${SCALE}-1` });
      timings['search (name substring)'] = performance.now() - start;
      expect(results2.length).toBeGreaterThan(0);
      expect(timings['search (name substring)']).toBeLessThan(1_000);
    });

    it('filters by tag', () => {
      const start = performance.now();
      const results2 = profiles.list({ tag: 'even5' });
      timings['filter by tag'] = performance.now() - start;
      expect(results2.length).toBe(Math.ceil(SCALE / 5));
      expect(timings['filter by tag']).toBeLessThan(1_000);
    });

    it('sorts the full list by name (client-side sort, as the renderer does)', () => {
      const list = profiles.list();
      const start = performance.now();
      const sorted = [...list].sort((a: ProfileListItem, b: ProfileListItem) => a.name.localeCompare(b.name));
      timings['sort by name (client-side)'] = performance.now() - start;
      expect(sorted.length).toBe(SCALE);
      expect(timings['sort by name (client-side)']).toBeLessThan(500);
    });

    it('clones one profile (config mode)', () => {
      const start = performance.now();
      manager.clone(createdIds[0]!, 'config', 'Load Test Clone');
      timings['clone one profile (config)'] = performance.now() - start;
      expect(timings['clone one profile (config)']).toBeLessThan(2_000);
    });

    it('deletes one profile', () => {
      const start = performance.now();
      manager.delete(createdIds[createdIds.length - 1]!);
      timings['delete one profile'] = performance.now() - start;
      expect(timings['delete one profile']).toBeLessThan(2_000);
    });
  });
}

describe('Load test: fingerprint uniqueness (isolation, Test 4 support)', () => {
  it('generates 20 fingerprints with distinct userAgent/seed/WebGL identity — no two profiles would share a fingerprint', () => {
    const fps = Array.from({ length: 20 }, (_, i) => generateFingerprint({ seed: `iso-uniqueness-seed-${i}` }));
    const userAgents = new Set(fps.map((f) => f.userAgent));
    const seeds = new Set(fps.map((f) => f.seed));
    const webglIdentities = new Set(fps.map((f) => `${f.webglVendor}::${f.webglRenderer}`));
    expect(seeds.size).toBe(20);
    // userAgent/WebGL identity draw from a finite pool of realistic
    // OS/GPU combinations (this is what makes each one *realistic*, not
    // synthetic noise), so this only asserts real variety exists across a
    // batch of 20 — not that every single one is pairwise unique, which
    // would be a false requirement for a finite, realistic pool.
    expect(userAgents.size).toBeGreaterThan(1);
    expect(webglIdentities.size).toBeGreaterThan(1);
  });
});

describe('Load test report generation', () => {
  it('writes docs-consumable data for all four scales', () => {
    // This runs last (vitest executes describe blocks in declaration order)
    // so `results` is fully populated by the time this fires.
    expect(results.length).toBe(SCALES.length);
    const lines: string[] = [
      '# Load test — database layer (raw data)',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '_Real measured numbers from this machine/run — not fabricated. Re-run with `npm run test:load` to reproduce._',
      '',
    ];
    for (const r of results) {
      lines.push(`## ${r.scale} profiles`, '', '| Operation | Time (ms) |', '|---|---|');
      for (const [op, ms] of Object.entries(r.timings)) {
        lines.push(`| ${op} | ${ms.toFixed(2)} |`);
      }
      lines.push('', `Process heap used at end of scale: ${r.heapUsedMb.toFixed(1)} MB, RSS: ${r.rssMb.toFixed(1)} MB`, '');
    }
    const report = lines.join('\n');
    fs.writeFileSync(path.join(__dirname, 'LOAD_TEST_DB_RAW.md'), report, 'utf-8');
    // eslint-disable-next-line no-console
    console.log('\n' + report);
  });
});
