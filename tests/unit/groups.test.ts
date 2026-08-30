import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { GroupRepository } from '../../src/main/database/groupRepository';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('GroupRepository', () => {
  let db: Database.Database;
  let groups: GroupRepository;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    groups = new GroupRepository(db);
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
  });

  it('creates, renames, and deletes a group', () => {
    const created = groups.create('Clients');
    expect(created.name).toBe('Clients');
    expect(created.profileCount).toBe(0);

    const renamed = groups.rename(created.id, 'Clients EU');
    expect(renamed.name).toBe('Clients EU');

    groups.delete(created.id);
    expect(groups.getById(created.id)).toBeNull();
  });

  it('rejects duplicate group names', () => {
    groups.create('Germany');
    expect(() => groups.create('Germany')).toThrow();
  });

  it('renaming to a name already used by another group is rejected', () => {
    groups.create('France');
    const b = groups.create('Ukraine');
    expect(() => groups.rename(b.id, 'France')).toThrow();
  });

  it('reports an accurate profile count per group', () => {
    const group = groups.create('Testing');
    const fp1 = fingerprints.create(generateFingerprint({ seed: 'group-1' }));
    const fp2 = fingerprints.create(generateFingerprint({ seed: 'group-2' }));
    profiles.create({ name: 'P1', profilePath: '/tmp/p1', fingerprintId: fp1.id, proxyId: null, groupId: group.id });
    profiles.create({ name: 'P2', profilePath: '/tmp/p2', fingerprintId: fp2.id, proxyId: null, groupId: group.id });

    expect(groups.getById(group.id)!.profileCount).toBe(2);
    expect(groups.list().find((g) => g.id === group.id)!.profileCount).toBe(2);
  });

  it('deleting a group sets group_id to NULL on its profiles instead of deleting them', () => {
    const group = groups.create('Personal');
    const fp = fingerprints.create(generateFingerprint({ seed: 'group-delete' }));
    const profile = profiles.create({
      name: 'Keep Me',
      profilePath: '/tmp/keep',
      fingerprintId: fp.id,
      proxyId: null,
      groupId: group.id,
    });

    groups.delete(group.id);

    const stillThere = profiles.getById(profile.id);
    expect(stillThere).not.toBeNull();
    expect(stillThere!.groupId).toBeNull();
  });

  it('profiles.list filters by groupId instantly (indexed column)', () => {
    const groupA = groups.create('Group A');
    const groupB = groups.create('Group B');
    const fpA = fingerprints.create(generateFingerprint({ seed: 'filter-a' }));
    const fpB = fingerprints.create(generateFingerprint({ seed: 'filter-b' }));
    profiles.create({ name: 'In A', profilePath: '/tmp/a', fingerprintId: fpA.id, proxyId: null, groupId: groupA.id });
    profiles.create({ name: 'In B', profilePath: '/tmp/b', fingerprintId: fpB.id, proxyId: null, groupId: groupB.id });

    const inA = profiles.list({ groupId: groupA.id });
    expect(inA.length).toBe(1);
    expect(inA[0]!.name).toBe('In A');
  });
});
