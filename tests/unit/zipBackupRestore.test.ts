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

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ZIP export/import round-trip', () => {
  let db: Database.Database;
  let root: string;
  let manager: ProfileManager;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;
  let proxies: ProxyRepository;
  let importExport: ImportExportService;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-zip-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs);
    importExport = new ImportExportService(profiles, fingerprints, proxies, logs, manager);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('writeFullExportZip produces a real zip containing manifest.json and browser-data, importable via importFromPaths', async () => {
    const fp = fingerprints.create(generateFingerprint({ seed: 'zip-full' }));
    const proxy = proxies.create({
      name: 'zip-proxy',
      protocol: 'http',
      host: '127.0.0.1',
      port: 8080,
      password: 'super-secret',
    });
    const source = manager.create({ name: 'Zip Source', proxyId: proxy.id, tags: ['zip-tag'] }, fp.id);
    fs.writeFileSync(path.join(source.profilePath, 'browser-data', 'cookies.sqlite'), 'real-cookie-data');

    const zipPath = path.join(root, 'export.zip');
    const manifest = importExport.buildManifest(source, 'full');
    importExport.writeFullExportZip(source, manifest, zipPath);

    expect(fs.existsSync(zipPath)).toBe(true);
    const zipBuffer = fs.readFileSync(zipPath);
    expect(zipBuffer.subarray(0, 2).toString('utf-8')).toBe('PK'); // real zip magic bytes, not a renamed folder

    const result = await importExport.importFromPaths([zipPath]);
    expect(result.errors).toEqual([]);
    expect(result.created.length).toBe(1);
    const imported = result.created[0]!;
    expect(imported.id).not.toBe(source.id);
    expect(imported.profilePath).not.toBe(source.profilePath);
    expect(
      fs.readFileSync(path.join(imported.profilePath, 'browser-data', 'cookies.sqlite'), 'utf-8'),
    ).toBe('real-cookie-data');

    // Proxy was recreated without the plaintext password ever round-tripping through the manifest.
    const importedProfile = profiles.getById(imported.id)!;
    expect(importedProfile.proxyId).not.toBeNull();
    expect(importedProfile.proxyId).not.toBe(proxy.id); // a fresh proxy row, not a shared reference
  });

  it('a bulk export zip (exportSelected-shaped) imports every contained profile independently', async () => {
    const fpA = fingerprints.create(generateFingerprint({ seed: 'zip-bulk-a' }));
    const fpB = fingerprints.create(generateFingerprint({ seed: 'zip-bulk-b' }));
    manager.create({ name: 'Bulk Zip A' }, fpA.id);
    manager.create({ name: 'Bulk Zip B' }, fpB.id);

    const zipPath = path.join(root, 'bulk-export.zip');
    importExport.writeSelectedExportZip(profiles.list().map((p) => p.id), zipPath);
    expect(fs.existsSync(zipPath)).toBe(true);

    // Fresh DB/manager to prove the zip is self-contained and portable.
    const db2 = createTestDb(migrationsDir);
    const root2 = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-zip-import-'));
    const profiles2 = new ProfileRepository(db2);
    const fingerprints2 = new FingerprintRepository(db2);
    const proxies2 = new ProxyRepository(db2);
    const logs2 = new ActivityLogRepository(db2);
    const manager2 = new ProfileManager(root2, profiles2, fingerprints2, proxies2, logs2);
    const importExport2 = new ImportExportService(profiles2, fingerprints2, proxies2, logs2, manager2);

    const result = await importExport2.importFromPaths([zipPath]);
    expect(result.errors).toEqual([]);
    expect(result.created.length).toBe(2);
    expect(profiles2.list().map((p) => p.name).sort()).toEqual(
      ['Bulk Zip A (imported)', 'Bulk Zip B (imported)'].sort(),
    );

    fs.rmSync(root2, { recursive: true, force: true });
  });

  it('a corrupted/non-zip file with a .zip extension is reported as an import error, not a crash', async () => {
    const fakeZip = path.join(root, 'not-really-a-zip.zip');
    fs.writeFileSync(fakeZip, 'this is not a zip file');

    const result = await importExport.importFromPaths([fakeZip]);
    expect(result.created).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.path).toBe(fakeZip);
  });
});
