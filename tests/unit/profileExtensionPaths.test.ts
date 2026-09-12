import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ProfileRepository extensionPaths', () => {
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

  it('defaults to an empty array for a newly created profile', () => {
    const profile = makeProfile('Fresh');
    expect(profile.extensionPaths).toEqual([]);
  });

  it('persists and round-trips a real list of extension paths through update()', () => {
    const profile = makeProfile('WithExtensions');
    const paths = ['C:\\ext\\one', 'C:\\ext\\two'];

    const updated = profiles.update(profile.id, { extensionPaths: paths });

    expect(updated.extensionPaths).toEqual(paths);
    expect(profiles.getById(profile.id)!.extensionPaths).toEqual(paths);
  });

  it('an update() call that never touches extensionPaths leaves the existing list untouched (no TOCTOU overwrite)', () => {
    const profile = makeProfile('Untouched');
    profiles.update(profile.id, { extensionPaths: ['/keep/me'] });

    profiles.update(profile.id, { name: 'Renamed' });

    expect(profiles.getById(profile.id)!.extensionPaths).toEqual(['/keep/me']);
  });

  it('can clear the list back to empty via an explicit empty array', () => {
    const profile = makeProfile('ToClear');
    profiles.update(profile.id, { extensionPaths: ['/one'] });

    profiles.update(profile.id, { extensionPaths: [] });

    expect(profiles.getById(profile.id)!.extensionPaths).toEqual([]);
  });

  it('a corrupted extension_paths value in the database is tolerated as an empty array, not a crash', () => {
    const profile = makeProfile('Corrupted');
    db.prepare('UPDATE profiles SET extension_paths = ? WHERE id = ?').run('{not-valid-json', profile.id);

    expect(profiles.getById(profile.id)!.extensionPaths).toEqual([]);
  });
});
