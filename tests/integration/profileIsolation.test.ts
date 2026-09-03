import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { ProfileManager } from '../../src/main/profiles/profileManager';

const migrationsDir = path.join(__dirname, '../../database/migrations');

/**
 * Covers isolation-related acceptance criteria without spawning a real browser
 * process (that requires an Electron runtime — see docs/TESTING.md for the
 * Playwright/Electron E2E suite that exercises full start/stop lifecycle).
 */
describe('ProfileManager storage isolation', () => {
  let db: Database.Database;
  let root: string;
  let manager: ProfileManager;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-integ-'));
    const profiles = new ProfileRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('gives each created profile its own storage directory', () => {
    const a = manager.create({ name: 'Profile A' }, new FingerprintRepositoryHelper(db).id('a'));
    const b = manager.create({ name: 'Profile B' }, new FingerprintRepositoryHelper(db).id('b'));

    expect(a.profilePath).not.toBe(b.profilePath);
    expect(fs.existsSync(a.profilePath)).toBe(true);
    expect(fs.existsSync(b.profilePath)).toBe(true);
  });

  it('profile A cannot see data written into profile B storage', () => {
    const a = manager.create({ name: 'A' }, new FingerprintRepositoryHelper(db).id('a2'));
    const b = manager.create({ name: 'B' }, new FingerprintRepositoryHelper(db).id('b2'));

    fs.writeFileSync(path.join(b.profilePath, 'browser-data', 'cookies.sqlite'), 'secret-b-data');

    expect(fs.existsSync(path.join(a.profilePath, 'browser-data', 'cookies.sqlite'))).toBe(false);
  });

  it('full clone copies storage into an independent directory; config clone does not', () => {
    const source = manager.create({ name: 'Source' }, new FingerprintRepositoryHelper(db).id('src'));
    fs.writeFileSync(path.join(source.profilePath, 'browser-data', 'marker.txt'), 'original');

    const fullClone = manager.clone(source.id, 'full', 'Full Clone');
    expect(fullClone.profilePath).not.toBe(source.profilePath);
    expect(fs.readFileSync(path.join(fullClone.profilePath, 'browser-data', 'marker.txt'), 'utf-8')).toBe(
      'original',
    );

    const configClone = manager.clone(source.id, 'config', 'Config Clone');
    expect(fs.existsSync(path.join(configClone.profilePath, 'browser-data', 'marker.txt'))).toBe(false);
  });

  it('deleting a profile soft-deletes it (storage untouched, undo window pending) without affecting other profiles', () => {
    // delete() is now soft: the real (hard) removal is scheduled in the
    // background after an undo window (see profileManager.ts's
    // SOFT_DELETE_WINDOW_MS) rather than happening synchronously — full
    // coverage of that timeout/undo behavior lives in
    // tests/unit/profileSoftDelete.test.ts, which controls the window via
    // PF_SOFT_DELETE_WINDOW_MS. This test stays scoped to storage isolation:
    // deleting A must never touch B's storage, soft or hard.
    const a = manager.create({ name: 'A3' }, new FingerprintRepositoryHelper(db).id('a3'));
    const b = manager.create({ name: 'B3' }, new FingerprintRepositoryHelper(db).id('b3'));

    manager.delete(a.id);

    expect(fs.existsSync(a.profilePath)).toBe(true);
    expect(fs.existsSync(b.profilePath)).toBe(true);
  });
});

/** Small helper so each test can mint a fresh fingerprint id inline. */
class FingerprintRepositoryHelper {
  private readonly repo: FingerprintRepository;
  constructor(db: Database.Database) {
    this.repo = new FingerprintRepository(db);
  }
  id(seed: string): string {
    return this.repo.create({
      name: `fp-${seed}`,
      os: 'windows',
      osVersion: '10.0',
      browserVersion: '128.0.0.0',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
      platform: 'Win32',
      locale: 'en-US',
      languages: ['en-US', 'en'],
      timezone: 'America/New_York',
      screenWidth: 1920,
      screenHeight: 1080,
      deviceScaleFactor: 1,
      hardwareConcurrency: 8,
      deviceMemory: 16,
      webglVendor: 'Google Inc. (NVIDIA)',
      webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
      canvasMode: 'noise',
      audioMode: 'noise',
      webrtcMode: 'proxy-only',
      fontsMode: 'system',
      mediaDevicesMode: 'real',
      webglSpoofingMode: 'off',
      geolocationMode: 'real',
      geolocationLatitude: 40.7128,
      geolocationLongitude: -74.006,
      permissionsMode: 'real',
      seed,
    }).id;
  }
}
