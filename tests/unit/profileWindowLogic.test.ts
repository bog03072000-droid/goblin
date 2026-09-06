import { describe, it, expect } from 'vitest';
import {
  resolveLanguages,
  buildSpoofableFingerprint,
  resolveEnforcementModes,
  resolveAutoNavigateTarget,
  normalizeNavigationUrl,
} from '../../src/main/browser/profileWindowLogic';

describe('resolveLanguages', () => {
  it('returns the fingerprint config\'s own languages array when present', () => {
    expect(resolveLanguages({ languages: ['uk-UA', 'uk', 'en'] }, 'en-US')).toEqual(['uk-UA', 'uk', 'en']);
  });

  it('falls back to a single-entry array of the locale when languages is missing', () => {
    expect(resolveLanguages({}, 'en-US')).toEqual(['en-US']);
  });

  it('falls back to the locale when languages is present but not an array', () => {
    expect(resolveLanguages({ languages: 'en-US' }, 'en-US')).toEqual(['en-US']);
  });
});

describe('buildSpoofableFingerprint', () => {
  it('carries through every configured field', () => {
    const config = {
      seed: 'seed-1',
      canvasMode: 'noise',
      audioMode: 'noise',
      deviceMemory: 16,
      webglSpoofingMode: 'spoof',
      webglVendor: 'Intel Inc.',
      webglRenderer: 'Intel Iris',
      fontsMode: 'restricted',
      mediaDevicesMode: 'hidden',
      platform: 'MacIntel',
      hardwareConcurrency: 12,
      serviceWorkerMode: 'disabled',
    };
    const result = buildSpoofableFingerprint(config, { userAgent: 'UA-string', profileId: 'p1' });
    expect(result).toEqual({
      seed: 'seed-1',
      canvasMode: 'noise',
      audioMode: 'noise',
      deviceMemory: 16,
      webglSpoofingMode: 'spoof',
      webglVendor: 'Intel Inc.',
      webglRenderer: 'Intel Iris',
      fontsMode: 'restricted',
      mediaDevicesMode: 'hidden',
      userAgent: 'UA-string',
      platform: 'MacIntel',
      hardwareConcurrency: 12,
      serviceWorkerMode: 'disabled',
    });
  });

  it('falls back to the profileId as seed, and to the same defaults a freshly generated profile has, when fields are missing', () => {
    const result = buildSpoofableFingerprint({}, { userAgent: 'UA-string', profileId: 'p1' });
    expect(result).toEqual({
      seed: 'p1',
      canvasMode: 'off',
      audioMode: 'off',
      deviceMemory: 8,
      webglSpoofingMode: 'off',
      webglVendor: 'Google Inc.',
      webglRenderer: 'ANGLE',
      fontsMode: 'system',
      mediaDevicesMode: 'real',
      userAgent: 'UA-string',
      platform: 'Win32',
      hardwareConcurrency: 8,
      serviceWorkerMode: 'real',
    });
  });
});

describe('resolveEnforcementModes', () => {
  it('carries through every configured mode', () => {
    expect(
      resolveEnforcementModes({ webrtcMode: 'disabled', geolocationMode: 'blocked', permissionsMode: 'deny-all' }),
    ).toEqual({ webrtcMode: 'disabled', geolocationMode: 'blocked', permissionsMode: 'deny-all' });
  });

  it('defaults every mode when the config is empty', () => {
    expect(resolveEnforcementModes({})).toEqual({
      webrtcMode: 'default',
      geolocationMode: 'real',
      permissionsMode: 'real',
    });
  });
});

describe('resolveAutoNavigateTarget', () => {
  const diagnosticsUrl = 'profileforge://fingerprint-test?config=abc';
  const defaultStartUrl = 'https://www.google.com';

  it('picks the diagnostics URL when PF_E2E_AUTO_DIAGNOSTICS=1, regardless of anything else set', () => {
    const result = resolveAutoNavigateTarget(
      { PF_E2E_AUTO_DIAGNOSTICS: '1', PF_E2E_PROXY_TEST_URL: 'https://proxy-test.example' },
      { navigateTo: 'https://redownload.example' },
      diagnosticsUrl,
      defaultStartUrl,
    );
    expect(result).toBe(diagnosticsUrl);
  });

  it('picks the proxy-test URL when set and diagnostics is not', () => {
    const result = resolveAutoNavigateTarget(
      { PF_E2E_PROXY_TEST_URL: 'https://proxy-test.example' },
      { navigateTo: 'https://redownload.example' },
      diagnosticsUrl,
      defaultStartUrl,
    );
    expect(result).toBe('https://proxy-test.example');
  });

  it('picks args.navigateTo when neither testing hook is set', () => {
    const result = resolveAutoNavigateTarget({}, { navigateTo: 'https://redownload.example' }, diagnosticsUrl, defaultStartUrl);
    expect(result).toBe('https://redownload.example');
  });

  it('falls back to the default start URL when nothing else applies', () => {
    const result = resolveAutoNavigateTarget({}, { navigateTo: null }, diagnosticsUrl, defaultStartUrl);
    expect(result).toBe(defaultStartUrl);
  });
});

describe('normalizeNavigationUrl', () => {
  it('adds https:// to a bare host with no scheme', () => {
    expect(normalizeNavigationUrl('example.com')).toBe('https://example.com');
  });

  it('leaves an already-schemed http(s) URL unchanged', () => {
    expect(normalizeNavigationUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeNavigationUrl('https://example.com')).toBe('https://example.com');
  });

  it('leaves a non-http scheme (e.g. the internal diagnostics scheme) unchanged', () => {
    expect(normalizeNavigationUrl('profileforge://fingerprint-test')).toBe('profileforge://fingerprint-test');
  });

  it('trims surrounding whitespace before checking for a scheme', () => {
    expect(normalizeNavigationUrl('  example.com  ')).toBe('https://example.com');
  });
});
