import { describe, it, expect } from 'vitest';
import { ProfileExportSchema, EXPORT_FORMAT, EXPORT_VERSION } from '../../src/shared/schemas/exportFormat';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

function validManifest() {
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    mode: 'config' as const,
    profile: { name: 'Test Profile', description: '', tags: ['a'] },
    fingerprint: generateFingerprint({ seed: 'export-test' }),
    proxy: null,
    metadata: { exportedAt: new Date().toISOString(), sourceAppVersion: '0.1.0' },
  };
}

describe('ProfileExportSchema', () => {
  it('accepts a well-formed manifest', () => {
    const result = ProfileExportSchema.safeParse(validManifest());
    expect(result.success).toBe(true);
  });

  it('rejects an unknown format string', () => {
    const bad = { ...validManifest(), format: 'some-other-browser' };
    expect(ProfileExportSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a future/unknown version number', () => {
    const bad = { ...validManifest(), version: 999 };
    expect(ProfileExportSchema.safeParse(bad).success).toBe(false);
  });

  it('never carries a proxy password field, even if injected', () => {
    const bad = { ...validManifest(), proxy: { name: 'p', protocol: 'http', host: 'h', port: 80, password: 'leaked' } };
    const parsed = ProfileExportSchema.parse(bad);
    expect(parsed.proxy).not.toHaveProperty('password');
  });

  it('rejects a manifest with a malformed fingerprint', () => {
    const bad = { ...validManifest(), fingerprint: { ...validManifest().fingerprint, screenWidth: -1 } };
    expect(ProfileExportSchema.safeParse(bad).success).toBe(false);
  });
});
