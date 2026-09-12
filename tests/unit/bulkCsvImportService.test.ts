import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { GroupRepository } from '../../src/main/database/groupRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { ProfileManager } from '../../src/main/profiles/profileManager';
import { BulkCsvImportService } from '../../src/main/profiles/bulkCsvImportService';
import type { BulkImportRow } from '../../src/main/profiles/bulkCsvImport';

const migrationsDir = path.join(__dirname, '../../database/migrations');

function makeRow(overrides: Partial<BulkImportRow> & { row: number; name: string }): BulkImportRow {
  return { tags: [], ...overrides };
}

describe('BulkCsvImportService.commit', () => {
  let db: Database.Database;
  let root: string;
  let service: BulkCsvImportService;
  let fingerprints: FingerprintRepository;
  let proxies: ProxyRepository;
  let groups: GroupRepository;
  let profiles: ProfileRepository;
  let manager: ProfileManager;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-bulk-import-svc-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    proxies = new ProxyRepository(db);
    groups = new GroupRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:', groups);
    service = new BulkCsvImportService(fingerprints, proxies, groups, manager, logs);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('creates a real profile+fingerprint per valid row', async () => {
    const rows = [
      makeRow({ row: 2, name: 'Alice', os: 'windows', tags: ['a', 'b'] }),
      makeRow({ row: 3, name: 'Bob', os: 'macos' }),
    ];

    const result = await service.commit(rows);

    expect(result.errors).toEqual([]);
    expect(result.created).toHaveLength(2);
    expect(result.created[0]!.name).toBe('Alice');
    expect(result.created[0]!.tags).toEqual(['a', 'b']);
    const fp = fingerprints.getById(result.created[0]!.fingerprintId)!;
    expect(fp.os).toBe('windows');
    // A real on-disk profile directory was actually created, not just a DB row.
    expect(fs.existsSync(result.created[0]!.profilePath)).toBe(true);
  });

  it('one row already flagged with a parse-time error is skipped and reported, never sent to profile creation', async () => {
    const rows = [
      makeRow({ row: 2, name: 'Alice' }),
      makeRow({ row: 3, name: '', error: 'Name is required' }),
    ];

    const result = await service.commit(rows);

    expect(result.created).toHaveLength(1);
    expect(result.errors).toEqual([{ row: 3, message: 'Name is required' }]);
  });

  it('resolves a proxyLabel to the matching real proxy id', async () => {
    const proxy = proxies.create({
      name: 'Residential US',
      protocol: 'http',
      host: '1.2.3.4',
      port: 8080,
      username: null,
      password: null,
    });
    const rows = [makeRow({ row: 2, name: 'Alice', proxyLabel: 'Residential US' })];

    const result = await service.commit(rows);

    expect(result.created[0]!.proxyId).toBe(proxy.id);
  });

  it('creates a brand-new group automatically when groupName does not match an existing one', async () => {
    const rows = [makeRow({ row: 2, name: 'Alice', groupName: 'Brand New Team' })];

    const result = await service.commit(rows);

    expect(result.errors).toEqual([]);
    const group = groups.list().find((g) => g.name === 'Brand New Team');
    expect(group).toBeDefined();
    expect(result.created[0]!.groupId).toBe(group!.id);
  });

  it('reuses the same auto-created group across multiple rows instead of creating it twice', async () => {
    const rows = [
      makeRow({ row: 2, name: 'Alice', groupName: 'Shared Team' }),
      makeRow({ row: 3, name: 'Bob', groupName: 'Shared Team' }),
    ];

    const result = await service.commit(rows);

    expect(result.errors).toEqual([]);
    expect(groups.list().filter((g) => g.name === 'Shared Team')).toHaveLength(1);
    expect(result.created[0]!.groupId).toBe(result.created[1]!.groupId);
  });

  it('reuses an already-existing group by name rather than creating a duplicate', async () => {
    const existing = groups.create('Existing Team');
    const rows = [makeRow({ row: 2, name: 'Alice', groupName: 'Existing Team' })];

    const result = await service.commit(rows);

    expect(result.created[0]!.groupId).toBe(existing.id);
    expect(groups.list().filter((g) => g.name === 'Existing Team')).toHaveLength(1);
  });

  it('one row failing unexpectedly at commit time never aborts the rest of the batch', async () => {
    // Forces a real failure on the first row only (profileManager.create is
    // real code — this just makes its one call for row 2 throw, matching
    // the shape of a genuine, unexpected creation failure) to prove row 3
    // still gets created afterward and the failure is reported against the
    // right row number, not swallowed or misattributed.
    const createSpy = vi.spyOn(manager, 'create');
    createSpy.mockImplementationOnce(() => {
      throw new Error('disk full');
    });

    const rows = [makeRow({ row: 2, name: 'Alice' }), makeRow({ row: 3, name: 'Bob' })];

    const result = await service.commit(rows);

    expect(result.created).toHaveLength(1);
    expect(result.created[0]!.name).toBe('Bob');
    expect(result.errors).toEqual([{ row: 2, message: 'disk full' }]);
  });

  it('returns an empty result for an empty row list', async () => {
    const result = await service.commit([]);
    expect(result).toEqual({ created: [], errors: [] });
  });
});
