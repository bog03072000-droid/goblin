import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('repositories', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
  });

  it('fingerprint repository round-trips a record', () => {
    const repo = new FingerprintRepository(db);
    const created = repo.create(generateFingerprint({ seed: 'repo-test' }));
    const fetched = repo.getById(created.id);
    expect(fetched).toEqual(created);
  });

  it('proxy repository encrypts the password and never returns it from list/getById', () => {
    const repo = new ProxyRepository(db);
    const created = repo.create({
      name: 'test-proxy',
      protocol: 'http',
      host: '127.0.0.1',
      port: 8080,
      username: 'user',
      password: 'super-secret',
    });
    expect(JSON.stringify(created)).not.toContain('super-secret');
    expect(JSON.stringify(repo.list())).not.toContain('super-secret');
    expect(repo.getPassword(created.id)).toBe('super-secret');
  });

  it('profile repository stores tags and filters by them', () => {
    const fingerprints = new FingerprintRepository(db);
    const profiles = new ProfileRepository(db);
    const fp = fingerprints.create(generateFingerprint({ seed: 'tag-test' }));

    const p1 = profiles.create({
      name: 'P1',
      profilePath: '/tmp/p1',
      fingerprintId: fp.id,
      proxyId: null,
      tags: ['work', 'eu'],
    });
    profiles.create({
      name: 'P2',
      profilePath: '/tmp/p2',
      fingerprintId: fp.id,
      proxyId: null,
      tags: ['personal'],
    });

    expect(profiles.list({ tag: 'work' }).map((p) => p.id)).toEqual([p1.id]);
    expect(profiles.list().length).toBe(2);
  });

  it('deleting a profile does not delete its fingerprint or affect other profiles', () => {
    const fingerprints = new FingerprintRepository(db);
    const profiles = new ProfileRepository(db);
    const fpA = fingerprints.create(generateFingerprint({ seed: 'a' }));
    const fpB = fingerprints.create(generateFingerprint({ seed: 'b' }));
    const a = profiles.create({ name: 'A', profilePath: '/tmp/a', fingerprintId: fpA.id, proxyId: null });
    const b = profiles.create({ name: 'B', profilePath: '/tmp/b', fingerprintId: fpB.id, proxyId: null });

    profiles.delete(a.id);

    expect(profiles.getById(a.id)).toBeNull();
    expect(profiles.getById(b.id)).not.toBeNull();
    expect(fingerprints.getById(fpB.id)).not.toBeNull();
  });
});
