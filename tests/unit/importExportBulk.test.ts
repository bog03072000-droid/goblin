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
import { generateFingerprint } from '../../src/main/fingerprint/generator';
import { EXPORT_FORMAT, EXPORT_VERSION } from '../../src/shared/schemas/exportFormat';

const migrationsDir = path.join(__dirname, '../../database/migrations');

function writeManifest(dir: string, name: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    mode: 'config',
    profile: { name, description: '', tags: [] },
    fingerprint: generateFingerprint({ seed: `bulk-import-${name}` }),
    proxy: null,
    metadata: { exportedAt: new Date().toISOString(), sourceAppVersion: '0.1.0' },
  };
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
}

describe('Bulk import (multi-file, error isolation, name collisions)', () => {
  let db: Database.Database;
  let root: string;
  let workDir: string;
  let importExport: ImportExportService;
  let profiles: ProfileRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bulk-import-'));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bulk-import-src-'));
    profiles = new ProfileRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    const manager = new ProfileManager(root, profiles, fingerprints, proxies, logs);
    importExport = new ImportExportService(profiles, fingerprints, proxies, logs, manager);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('imports multiple valid files in one call', async () => {
    const dirA = path.join(workDir, 'a');
    const dirB = path.join(workDir, 'b');
    writeManifest(dirA, 'Import A');
    writeManifest(dirB, 'Import B');

    const result = await importExport.importFromPaths([dirA, dirB]);
    expect(result.errors).toEqual([]);
    expect(result.created.length).toBe(2);
    expect(profiles.list().length).toBe(2);
  });

  it('one invalid entry does not abort the rest of the batch', async () => {
    const dirGood = path.join(workDir, 'good');
    const dirBad = path.join(workDir, 'bad');
    writeManifest(dirGood, 'Good Profile');
    fs.mkdirSync(dirBad, { recursive: true }); // no manifest.json inside

    const result = await importExport.importFromPaths([dirGood, dirBad]);
    expect(result.created.length).toBe(1);
    expect(result.created[0]!.name).toContain('Good Profile');
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.path).toBe(dirBad);
  });

  it('a manifest with an invalid fingerprint is reported as an error, not silently skipped or crashed', async () => {
    const dir = path.join(workDir, 'malformed');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({ format: 'not-profileforge', version: 999 }),
      'utf-8',
    );
    const result = await importExport.importFromPaths([dir]);
    expect(result.created.length).toBe(0);
    expect(result.errors.length).toBe(1);
  });

  it('never overwrites an existing profile — duplicate names get a numbered suffix', async () => {
    const dir1 = path.join(workDir, 'dup1');
    const dir2 = path.join(workDir, 'dup2');
    writeManifest(dir1, 'Same Name');
    writeManifest(dir2, 'Same Name');

    const first = await importExport.importFromPaths([dir1]);
    const second = await importExport.importFromPaths([dir2]);

    expect(first.created[0]!.name).toBe('Same Name (imported)');
    expect(second.created[0]!.name).toBe('Same Name (imported 2)');
    expect(first.created[0]!.id).not.toBe(second.created[0]!.id);
    expect(profiles.list().length).toBe(2);
  });
});
