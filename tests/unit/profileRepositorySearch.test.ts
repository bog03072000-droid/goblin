import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

/**
 * Real bug found in a live UX walkthrough (npm run dev:electron, Profiles
 * page search box): typing a lowercase Cyrillic query found nothing for a
 * profile whose stored name was capitalized, because SQLite's built-in
 * LIKE only case-folds the 26 ASCII letters. Fixed via db.ts's
 * lower_unicode() custom SQL function — this covers the exact repository
 * layer that bug lived in, not just the higher-level IPC wiring tests in
 * registerIpc.test.ts (which mock the repository and can't catch a real
 * SQL bug).
 */
describe('ProfileRepository.list({ search }) — case-insensitivity', () => {
  let db: Database.Database;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
  });

  function makeProfile(name: string) {
    const fp = fingerprints.create(generateFingerprint({ seed: name }));
    return profiles.create({ name, profilePath: `/p/${name}`, fingerprintId: fp.id, proxyId: null });
  }

  it('matches ASCII substrings case-insensitively (pre-existing behavior)', () => {
    makeProfile('Quick Test Profile');
    expect(profiles.list({ search: 'quick' })).toHaveLength(1);
  });

  it('matches Cyrillic substrings case-insensitively, not just ASCII', () => {
    makeProfile('Мій тестовий профіль');
    expect(profiles.list({ search: 'мій' })).toHaveLength(1);
    expect(profiles.list({ search: 'МІЙ' })).toHaveLength(1);
    expect(profiles.list({ search: 'Мій' })).toHaveLength(1);
  });

  it('a genuinely non-matching search still returns nothing', () => {
    makeProfile('Мій тестовий профіль');
    expect(profiles.list({ search: 'зовсім інше' })).toHaveLength(0);
  });
});
