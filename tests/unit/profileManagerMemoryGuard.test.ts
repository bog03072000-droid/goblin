import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';
import { SAFE_FREE_RAM_MARGIN_MB, ESTIMATED_MB_PER_RUNNING_PROFILE } from '../../src/main/profiles/memoryGuard';

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
}

vi.mock('../../src/main/browser/browserLauncher', () => ({
  launchProfileProcess: vi.fn(() => new FakeChildProcess()),
  isTransientSpawnError: () => false,
}));

// Only freemem() is stubbed per-test (see beforeEach) — every other node:os
// export (tmpdir(), used by this file's own fixture setup) stays real, via
// importOriginal, so this doesn't have the blast radius of mocking the
// whole module.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, default: { ...actual, freemem: vi.fn(() => actual.freemem()) } };
});

const { ProfileManager } = await import('../../src/main/profiles/profileManager');
const mockedOs = (await import('node:os')).default as unknown as typeof os & { freemem: ReturnType<typeof vi.fn> };

const migrationsDir = path.join(__dirname, '../../database/migrations');
const MB = 1024 * 1024;

describe('ProfileManager start() — low-memory soft limit', () => {
  let db: Database.Database;
  let root: string;
  let manager: InstanceType<typeof ProfileManager>;
  let fingerprints: FingerprintRepository;
  let profiles: ProfileRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    (process.versions as Record<string, string>).chrome = '128.0.0.0';
    mockedOs.freemem.mockReturnValue(50_000 * MB); // plenty, by default
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-mgr-mem-'));
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

  it('starts normally when plenty of RAM is free', () => {
    const profile = makeProfile('Plenty Of RAM');
    expect(() => manager.start(profile.id)).not.toThrow();
    expect(profiles.getById(profile.id)!.status).toBe('RUNNING');
  });

  it('throws a LowMemoryError instead of starting when free RAM is below the safe margin', () => {
    mockedOs.freemem.mockReturnValue((SAFE_FREE_RAM_MARGIN_MB + ESTIMATED_MB_PER_RUNNING_PROFILE - 100) * MB);
    const profile = makeProfile('Low RAM');
    expect(() => manager.start(profile.id)).toThrowError(/LOW_MEMORY:/);
    expect(profiles.getById(profile.id)!.status).not.toBe('RUNNING');
  });

  it('starts anyway when low on RAM but acknowledgeLowMemory is set', () => {
    mockedOs.freemem.mockReturnValue(100 * MB);
    const profile = makeProfile('Low RAM Acknowledged');
    expect(() => manager.start(profile.id, { acknowledgeLowMemory: true })).not.toThrow();
    expect(profiles.getById(profile.id)!.status).toBe('RUNNING');
  });

  it('bulkStart never throws the low-memory error even under simulated low memory — it throttles its own chunk size instead', async () => {
    mockedOs.freemem.mockReturnValue((SAFE_FREE_RAM_MARGIN_MB + ESTIMATED_MB_PER_RUNNING_PROFILE - 100) * MB);
    const ids = [makeProfile('Bulk A').id, makeProfile('Bulk B').id, makeProfile('Bulk C').id];
    const result = await manager.bulkStart(ids);
    expect(result.failed).toEqual([]);
    expect(result.succeeded.sort()).toEqual(ids.sort());
  });
});
