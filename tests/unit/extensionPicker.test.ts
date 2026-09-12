import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateExtensionDirectory } from '../../src/main/profiles/extensionPicker';

describe('validateExtensionDirectory', () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeDir(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-ext-picker-'));
    return dir;
  }

  it('extracts name and manifest_version from a real, valid manifest.json', () => {
    const d = makeDir();
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ name: 'My Extension', manifest_version: 3 }));

    const result = validateExtensionDirectory(d);

    expect(result).toEqual({ path: d, name: 'My Extension', manifestVersion: 3 });
  });

  it('falls back to the directory path as the name when manifest.json has no "name" field', () => {
    const d = makeDir();
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ manifest_version: 2 }));

    expect(validateExtensionDirectory(d).name).toBe(d);
  });

  it('reports manifestVersion null when the field is missing or not a number', () => {
    const d = makeDir();
    fs.writeFileSync(path.join(d, 'manifest.json'), JSON.stringify({ name: 'X', manifest_version: 'three' }));

    expect(validateExtensionDirectory(d).manifestVersion).toBeNull();
  });

  it('throws a clear error when the folder has no manifest.json at all', () => {
    const d = makeDir();

    expect(() => validateExtensionDirectory(d)).toThrow(/no manifest\.json/);
  });

  it('throws a clear error when manifest.json exists but is not valid JSON', () => {
    const d = makeDir();
    fs.writeFileSync(path.join(d, 'manifest.json'), '{not valid json');

    expect(() => validateExtensionDirectory(d)).toThrow(/not valid JSON/);
  });
});
