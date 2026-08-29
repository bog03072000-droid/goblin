import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  resolveProfileDir,
  createProfileStorage,
  deleteProfileStorage,
  profileStorageExists,
} from '../../src/main/storage/profileStorage';

describe('profileStorage path security', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-test-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves a valid UUID profile id inside the root', () => {
    const id = randomUUID();
    const dir = resolveProfileDir(root, id);
    expect(dir).toBe(path.resolve(root, id));
  });

  it('rejects path traversal via ../', () => {
    expect(() => resolveProfileDir(root, '../../etc')).toThrow();
  });

  it('rejects a non-UUID profile id', () => {
    expect(() => resolveProfileDir(root, 'not-a-uuid')).toThrow();
  });

  it('rejects absolute paths disguised as an id', () => {
    expect(() => resolveProfileDir(root, 'C:\\Windows\\System32')).toThrow();
  });

  it('creates and deletes isolated storage per profile', () => {
    const idA = randomUUID();
    const idB = randomUUID();
    createProfileStorage(root, idA);
    createProfileStorage(root, idB);

    expect(profileStorageExists(root, idA)).toBe(true);
    expect(profileStorageExists(root, idB)).toBe(true);

    fs.writeFileSync(path.join(resolveProfileDir(root, idA), 'browser-data', 'marker.txt'), 'A');
    expect(fs.existsSync(path.join(resolveProfileDir(root, idB), 'browser-data', 'marker.txt'))).toBe(false);

    deleteProfileStorage(root, idA);
    expect(profileStorageExists(root, idA)).toBe(false);
    expect(profileStorageExists(root, idB)).toBe(true);
  });
});
