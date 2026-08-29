import { describe, it, expect } from 'vitest';
import { generateFingerprint } from '../../src/main/fingerprint/generator';
import { validateFingerprint } from '../../src/main/fingerprint/validator';

describe('fingerprint generator', () => {
  it('is deterministic for the same seed', () => {
    const a = generateFingerprint({ seed: 'profile-001' });
    const b = generateFingerprint({ seed: 'profile-001' });
    expect(a).toEqual(b);
  });

  it('produces different configurations for different seeds', () => {
    const seeds = Array.from({ length: 20 }, (_, i) => `seed-${i}`);
    const results = seeds.map((s) => generateFingerprint({ seed: s }));
    const unique = new Set(results.map((r) => JSON.stringify(r)));
    expect(unique.size).toBeGreaterThan(1);
  });

  it('always produces a fingerprint that passes its own validator', () => {
    for (let i = 0; i < 30; i++) {
      const fp = generateFingerprint({ seed: `check-${i}` });
      const result = validateFingerprint(fp);
      expect(result.errors, JSON.stringify({ fp, result })).toEqual([]);
    }
  });

  it('respects an explicit os constraint', () => {
    const fp = generateFingerprint({ seed: 'mac-seed', os: 'macos' });
    expect(fp.os).toBe('macos');
    expect(fp.platform).toBe('MacIntel');
  });
});

describe('fingerprint validator', () => {
  it('rejects a Windows OS with a macOS platform string', () => {
    const fp = generateFingerprint({ seed: 'win-seed', os: 'windows' });
    const broken = { ...fp, platform: 'MacIntel' };
    const result = validateFingerprint(broken);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects an Apple GPU renderer on a non-macOS profile', () => {
    const fp = generateFingerprint({ seed: 'linux-seed', os: 'linux' });
    const broken = { ...fp, webglRenderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' };
    const result = validateFingerprint(broken);
    expect(result.valid).toBe(false);
  });

  it('warns (but does not error) on an unusual timezone/locale pairing', () => {
    const fp = generateFingerprint({ seed: 'de-seed', locale: 'de-DE' });
    const unusual = { ...fp, timezone: 'America/New_York' };
    const result = validateFingerprint(unusual);
    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
