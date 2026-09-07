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
import { ImportExportService } from '../../src/main/profiles/importExport';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ImportExportService.importFromCompetitor', () => {
  let db: Database.Database;
  let root: string;
  let workDir: string;
  let importExport: ImportExportService;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-competitor-import-'));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-competitor-import-src-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    const manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
    importExport = new ImportExportService(profiles, fingerprints, proxies, logs, manager);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  function writeGoLoginFile(name: string, content: unknown): string {
    const filePath = path.join(workDir, name);
    fs.writeFileSync(filePath, JSON.stringify(content), 'utf-8');
    return filePath;
  }

  it('imports a single GoLogin profile JSON file, creating one real profile+fingerprint', async () => {
    const filePath = writeGoLoginFile('profile.json', {
      name: 'GoLogin Profile A',
      os: 'win',
      navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/119.0.0.0', hardwareConcurrency: 8 },
    });

    const result = await importExport.importFromCompetitor([filePath], 'gologin');

    expect(result.errors).toEqual([]);
    expect(result.created.length).toBe(1);
    expect(result.created[0]!.name).toContain('GoLogin Profile A');
    const fp = fingerprints.getById(result.created[0]!.fingerprintId)!;
    expect(fp.os).toBe('windows');
    expect(fp.hardwareConcurrency).toBe(8);
  });

  it('imports every entry from an array-shaped GoLogin export (multiple profiles in one file)', async () => {
    const filePath = writeGoLoginFile('bulk.json', [
      { name: 'Profile One', os: 'win' },
      { name: 'Profile Two', os: 'mac' },
      { name: 'Profile Three', os: 'lin' },
    ]);

    const result = await importExport.importFromCompetitor([filePath], 'gologin');

    expect(result.errors).toEqual([]);
    expect(result.created.length).toBe(3);
    const oses = result.created
      .map((p) => fingerprints.getById(p.fingerprintId)!.os)
      .sort();
    expect(oses).toEqual(['linux', 'macos', 'windows']);
  });

  it('one malformed entry in a bulk array does not abort importing the rest', async () => {
    const filePath = writeGoLoginFile('mixed.json', ['not-an-object-profile', { name: 'Valid Profile', os: 'win' }]);

    const result = await importExport.importFromCompetitor([filePath], 'gologin');

    expect(result.created.length).toBe(1);
    expect(result.created[0]!.name).toContain('Valid Profile');
    expect(result.errors.length).toBe(1);
  });

  it('a completely unreadable/non-JSON file produces an error for that path without throwing', async () => {
    const filePath = path.join(workDir, 'not-json.json');
    fs.writeFileSync(filePath, 'this is not valid JSON at all {{{', 'utf-8');

    const result = await importExport.importFromCompetitor([filePath], 'gologin');

    expect(result.created).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.path).toBe(filePath);
  });

  it('one bad file among several valid ones does not abort the whole batch', async () => {
    const goodPath = writeGoLoginFile('good.json', { name: 'Good Profile', os: 'win' });
    const badPath = path.join(workDir, 'bad.json');
    fs.writeFileSync(badPath, 'not json', 'utf-8');

    const result = await importExport.importFromCompetitor([goodPath, badPath], 'gologin');

    expect(result.created.length).toBe(1);
    expect(result.errors.length).toBe(1);
  });

  it('imported profiles get a distinct, non-colliding name even when imported twice', async () => {
    const filePath = writeGoLoginFile('dup.json', { name: 'Duplicate Name', os: 'win' });

    const first = await importExport.importFromCompetitor([filePath], 'gologin');
    const second = await importExport.importFromCompetitor([filePath], 'gologin');

    expect(first.created[0]!.name).not.toBe(second.created[0]!.name);
  });
});
