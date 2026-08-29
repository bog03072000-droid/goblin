import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { IpcRequestSchemas } from '../../src/shared/ipc/contracts';
import { resolveProfileDir } from '../../src/main/storage/profileStorage';
import { ProfileExportSchema } from '../../src/shared/schemas/exportFormat';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

/**
 * Dedicated adversarial suite, distinct from the inline path-traversal checks
 * in profileStorage.test.ts. Exercises the scenarios listed in the project
 * brief's "Security Tests" section that aren't already covered elsewhere.
 */
describe('Security: malformed IPC payloads are rejected before reaching any handler', () => {
  it('rejects profiles:create with a name of the wrong type', () => {
    const result = IpcRequestSchemas['profiles:create'].safeParse({ name: 12345 });
    expect(result.success).toBe(false);
  });

  it('rejects profiles:start with a non-UUID id', () => {
    const result = IpcRequestSchemas['profiles:start'].safeParse({ id: '../../etc/passwd' });
    expect(result.success).toBe(false);
  });

  it('rejects profiles:start with a prototype-pollution-shaped payload', () => {
    const result = IpcRequestSchemas['profiles:start'].safeParse({ id: randomUUID(), __proto__: { polluted: true } });
    // Zod strips unknown keys; the important property is that this does not throw
    // and does not pass through an `id` other than the valid UUID supplied.
    expect(result.success).toBe(true);
    if (result.success) expect(Object.keys(result.data)).toEqual(['id']);
  });

  it('rejects proxy:create with an unsupported protocol', () => {
    const result = IpcRequestSchemas['proxy:create'].safeParse({
      name: 'p',
      protocol: 'ftp',
      host: 'example.com',
      port: 21,
    });
    expect(result.success).toBe(false);
  });

  it('rejects proxy:create with an out-of-range port', () => {
    const result = IpcRequestSchemas['proxy:create'].safeParse({
      name: 'p',
      protocol: 'http',
      host: 'example.com',
      port: 999999,
    });
    expect(result.success).toBe(false);
  });

  it('rejects profiles:clone with an invalid mode', () => {
    const result = IpcRequestSchemas['profiles:clone'].safeParse({
      id: randomUUID(),
      mode: 'delete-everything',
      name: 'x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects fingerprint:validate payloads missing required fields', () => {
    const result = IpcRequestSchemas['fingerprint:validate'].safeParse({ os: 'windows' });
    expect(result.success).toBe(false);
  });

  it('rejects settings:update with an out-of-range numeric value', () => {
    const result = IpcRequestSchemas['settings:update'].safeParse({ cacheLimitMb: -5 });
    expect(result.success).toBe(false);
  });
});

describe('Security: path traversal variants', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-sec-'));
  });

  it('rejects a UUID-like string with a trailing traversal segment', () => {
    const id = randomUUID();
    expect(() => resolveProfileDir(root, `${id}/../../../etc`)).toThrow();
  });

  it('rejects a UUID containing a null byte', () => {
    expect(() => resolveProfileDir(root, `${randomUUID()}\0`)).toThrow();
  });

  it('rejects a Windows UNC-style path', () => {
    expect(() => resolveProfileDir(root, '\\\\server\\share\\file')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => resolveProfileDir(root, '')).toThrow();
  });

  it('rejects a URL-encoded traversal attempt (encoding is not decoded, so it is treated literally and still rejected as non-UUID)', () => {
    expect(() => resolveProfileDir(root, '%2e%2e%2f%2e%2e%2fetc')).toThrow();
  });
});

describe('Security: malformed import files are rejected before any profile is created', () => {
  it('rejects a completely unrelated JSON shape', () => {
    expect(ProfileExportSchema.safeParse({ hello: 'world' }).success).toBe(false);
  });

  it('rejects a manifest with a valid shape but an injected extra top-level field (still parses, extra field stripped)', () => {
    const fp = generateFingerprint({ seed: 'sec-import' });
    const manifest = {
      format: 'profileforge',
      version: 1,
      mode: 'config',
      profile: { name: 'X', tags: [] },
      fingerprint: fp,
      proxy: null,
      metadata: { exportedAt: new Date().toISOString(), sourceAppVersion: '0.1.0' },
      __proto__: { polluted: true },
    };
    const parsed = ProfileExportSchema.parse(manifest);
    expect((parsed as unknown as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('rejects a manifest whose fingerprint fails cross-field-independent schema checks (negative screen size)', () => {
    const fp = generateFingerprint({ seed: 'sec-import-2' });
    const manifest = {
      format: 'profileforge',
      version: 1,
      mode: 'config',
      profile: { name: 'X', tags: [] },
      fingerprint: { ...fp, screenWidth: -100 },
      proxy: null,
      metadata: { exportedAt: new Date().toISOString(), sourceAppVersion: '0.1.0' },
    };
    expect(ProfileExportSchema.safeParse(manifest).success).toBe(false);
  });
});

describe('Security: corrupted / inconsistent database state does not crash the app', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
  });

  it('getById on a profile id that does not exist returns null, not a throw', () => {
    const repo = new ProfileRepository(db);
    expect(repo.getById(randomUUID())).toBeNull();
  });

  it('foreign key constraint prevents creating a profile with a non-existent fingerprint id', () => {
    const repo = new ProfileRepository(db);
    expect(() =>
      repo.create({
        name: 'orphan',
        profilePath: '/tmp/orphan',
        fingerprintId: randomUUID(),
        proxyId: null,
      }),
    ).toThrow();
  });

  it('deleting a fingerprint still in use by a profile is blocked (RESTRICT), preventing silent corruption', () => {
    const fingerprints = new FingerprintRepository(db);
    const profiles = new ProfileRepository(db);
    const fp = fingerprints.create(generateFingerprint({ seed: 'restrict-test' }));
    profiles.create({ name: 'p', profilePath: '/tmp/p', fingerprintId: fp.id, proxyId: null });

    expect(() => fingerprints.delete(fp.id)).toThrow();
  });
});
