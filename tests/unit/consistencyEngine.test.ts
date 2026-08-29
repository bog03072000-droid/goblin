import { describe, it, expect } from 'vitest';
import { generateFingerprint } from '../../src/main/fingerprint/generator';
import { validateFingerprint } from '../../src/main/fingerprint/validator';

/**
 * Dedicated coverage for the "impossible combination" examples named
 * explicitly in the fingerprint audit brief, beyond the general coherence
 * tests already in fingerprintGenerator.test.ts.
 */
describe('Consistency engine: impossible combinations are rejected', () => {
  it('rejects Windows OS paired with a macOS-only platform string', () => {
    const fp = generateFingerprint({ seed: 'consistency-win', os: 'windows' });
    const broken = { ...fp, platform: 'MacIntel' };
    expect(validateFingerprint(broken).valid).toBe(false);
  });

  it('rejects macOS OS paired with a Windows-only User-Agent', () => {
    const fp = generateFingerprint({ seed: 'consistency-mac', os: 'macos' });
    const broken = {
      ...fp,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    };
    expect(validateFingerprint(broken).valid).toBe(false);
  });

  it('warns on an implausible CPU/RAM pairing (16+ cores with 2GB RAM)', () => {
    const fp = generateFingerprint({ seed: 'consistency-hw' });
    const broken = { ...fp, hardwareConcurrency: 32, deviceMemory: 1 };
    const result = validateFingerprint(broken);
    expect(result.valid).toBe(true); // implausible, not impossible — warning, not error
    expect(result.warnings.some((w) => w.includes('implausible hardware pairing'))).toBe(true);
  });

  it('warns on an implausible CPU/RAM pairing (16GB RAM with 1 core)', () => {
    const fp = generateFingerprint({ seed: 'consistency-hw-2' });
    const broken = { ...fp, hardwareConcurrency: 1, deviceMemory: 32 };
    const result = validateFingerprint(broken);
    expect(result.warnings.some((w) => w.includes('implausible hardware pairing'))).toBe(true);
  });

  it('does not warn on a plausible CPU/RAM pairing', () => {
    const fp = generateFingerprint({ seed: 'consistency-hw-ok' });
    const broken = { ...fp, hardwareConcurrency: 8, deviceMemory: 16 };
    const result = validateFingerprint(broken);
    expect(result.warnings.some((w) => w.includes('implausible hardware pairing'))).toBe(false);
  });
});
