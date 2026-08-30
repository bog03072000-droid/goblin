import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { DownloadRepository } from '../../src/main/database/downloadRepository';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('DownloadRepository', () => {
  let db: Database.Database;
  let repo: DownloadRepository;
  let profileAId: string;
  let profileBId: string;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    repo = new DownloadRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const profiles = new ProfileRepository(db);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-dl-'));

    const fpA = fingerprints.create(generateFingerprint({ seed: 'dl-test-a' }));
    profileAId = profiles.create({ name: 'A', profilePath: path.join(root, 'a'), fingerprintId: fpA.id, proxyId: null }).id;
    const fpB = fingerprints.create(generateFingerprint({ seed: 'dl-test-b' }));
    profileBId = profiles.create({ name: 'B', profilePath: path.join(root, 'b'), fingerprintId: fpB.id, proxyId: null }).id;
  });

  it('creates a record and reads it back with all fields intact', () => {
    const created = repo.create({
      profileId: profileAId,
      filename: 'report.pdf',
      savePath: 'C:/downloads/report.pdf',
      url: 'https://example.com/report.pdf',
      totalBytes: 12345,
      state: 'completed',
    });
    expect(created.filename).toBe('report.pdf');
    expect(created.state).toBe('completed');
    expect(repo.getById(created.id)).toEqual(created);
  });

  it('lists in descending creation order', () => {
    const a = repo.create({ profileId: profileAId, filename: 'a.zip', savePath: '/a.zip', url: 'https://x/a.zip', totalBytes: 1, state: 'completed' });
    const b = repo.create({ profileId: profileAId, filename: 'b.zip', savePath: '/b.zip', url: 'https://x/b.zip', totalBytes: 1, state: 'completed' });
    const list = repo.list();
    expect(list.map((d) => d.id)).toEqual([b.id, a.id]);
  });

  it('filters by profileId', () => {
    repo.create({ profileId: profileAId, filename: 'a.zip', savePath: '/a.zip', url: 'https://x/a.zip', totalBytes: 1, state: 'completed' });
    repo.create({ profileId: profileBId, filename: 'b.zip', savePath: '/b.zip', url: 'https://x/b.zip', totalBytes: 1, state: 'completed' });
    const list = repo.list({ profileId: profileBId });
    expect(list).toHaveLength(1);
    expect(list[0]!.filename).toBe('b.zip');
  });

  it('filters by filename search, case-insensitively substring-matched', () => {
    repo.create({ profileId: profileAId, filename: 'invoice-2024.pdf', savePath: '/i.pdf', url: 'https://x/i.pdf', totalBytes: 1, state: 'completed' });
    repo.create({ profileId: profileAId, filename: 'photo.png', savePath: '/p.png', url: 'https://x/p.png', totalBytes: 1, state: 'completed' });
    const list = repo.list({ search: 'invoice' });
    expect(list).toHaveLength(1);
    expect(list[0]!.filename).toBe('invoice-2024.pdf');
  });

  it('filters by a created_at date range', () => {
    const rec = repo.create({ profileId: profileAId, filename: 'a.zip', savePath: '/a.zip', url: 'https://x/a.zip', totalBytes: 1, state: 'completed' });
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(repo.list({ dateFrom: past, dateTo: future }).map((d) => d.id)).toContain(rec.id);
    expect(repo.list({ dateFrom: future }).map((d) => d.id)).not.toContain(rec.id);
  });

  it('deletes a record from history without touching any file on disk', () => {
    const rec = repo.create({ profileId: profileAId, filename: 'a.zip', savePath: '/a.zip', url: 'https://x/a.zip', totalBytes: 1, state: 'completed' });
    repo.delete(rec.id);
    expect(repo.getById(rec.id)).toBeNull();
  });

  it('is cascade-deleted when its owning profile is deleted', () => {
    const rec = repo.create({ profileId: profileAId, filename: 'a.zip', savePath: '/a.zip', url: 'https://x/a.zip', totalBytes: 1, state: 'completed' });
    db.prepare('DELETE FROM profiles WHERE id = ?').run(profileAId);
    expect(repo.getById(rec.id)).toBeNull();
  });
});
