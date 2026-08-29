import { describe, it, expect } from 'vitest';
import { checkBrowserCompatibility } from '../../src/main/fingerprint/browserCompatibility';

describe('checkBrowserCompatibility', () => {
  it('is compatible when major versions match', () => {
    const result = checkBrowserCompatibility('128.0.0.0', '128.0.6613.186');
    expect(result.compatible).toBe(true);
    expect(result.message).toBeNull();
  });

  it('flags an incompatibility when the running Chromium has moved on', () => {
    const result = checkBrowserCompatibility('128.0.0.0', '132.0.6834.83');
    expect(result.compatible).toBe(false);
    expect(result.message).toContain('128');
    expect(result.message).toContain('132');
  });

  it('does not care about minor/patch differences, only the major version', () => {
    const result = checkBrowserCompatibility('128.0.0.0', '128.9.9999.1');
    expect(result.compatible).toBe(true);
  });
});
