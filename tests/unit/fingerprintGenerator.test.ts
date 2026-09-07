import { describe, it, expect } from 'vitest';
import { generateFingerprint } from '../../src/main/fingerprint/generator';
import { validateFingerprint } from '../../src/main/fingerprint/validator';
import { LOCALE_PROFILES, PLATFORM_PROFILES } from '../../src/main/fingerprint/platformProfiles';

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

  it('android profiles report a real Chrome-for-Android platform string, touch points, and portrait-capable screens', () => {
    for (let i = 0; i < 15; i++) {
      const fp = generateFingerprint({ seed: `android-${i}`, os: 'android' });
      expect(fp.os).toBe('android');
      expect(fp.platform).toBe('Linux armv8l');
      expect(fp.userAgent.toLowerCase()).toContain('android');
      expect(fp.maxTouchPoints).toBe(5);
      // Real Android hardwareConcurrency is desktop-atypically low.
      expect(fp.hardwareConcurrency).toBeLessThanOrEqual(8);
    }
  });

  it('ios profiles report a real iPhone platform string, touch points, and an Apple-referencing WebGL renderer', () => {
    for (let i = 0; i < 15; i++) {
      const fp = generateFingerprint({ seed: `ios-${i}`, os: 'ios' });
      expect(fp.os).toBe('ios');
      expect(fp.platform).toBe('iPhone');
      expect(fp.userAgent.toLowerCase()).toContain('iphone');
      expect(fp.maxTouchPoints).toBe(5);
      expect(fp.webglRenderer.toLowerCase()).toContain('apple');
      expect(fp.hardwareConcurrency).toBe(6);
    }
  });

  it('every mobile screen\'s deviceScaleFactor is picked together with its resolution, never independently mismatched', () => {
    for (const os of ['android', 'ios'] as const) {
      for (let i = 0; i < 20; i++) {
        const fp = generateFingerprint({ seed: `mobile-dsf-${os}-${i}`, os });
        const platform = PLATFORM_PROFILES.find((p) => p.os === os)!;
        const matchingScreen = platform.screens.find((s) => s.width === fp.screenWidth && s.height === fp.screenHeight);
        expect(matchingScreen, `no bundle screen matched ${fp.screenWidth}x${fp.screenHeight} for os=${os}`).toBeTruthy();
        expect(fp.deviceScaleFactor).toBe(matchingScreen!.deviceScaleFactor);
      }
    }
  });

  it('a desktop OS never gets a nonzero maxTouchPoints from the generator', () => {
    for (const os of ['windows', 'macos', 'linux'] as const) {
      for (let i = 0; i < 10; i++) {
        const fp = generateFingerprint({ seed: `desktop-touch-${os}-${i}`, os });
        expect(fp.maxTouchPoints).toBe(0);
      }
    }
  });

  it('defaults webglSpoofingMode to "spoof" and serviceWorkerMode to "disabled" — both closed by default, not opt-in, because leaving either "off" silently leaked a correlatable real fingerprint on every profile (see docs/FINGERPRINT_AUDIT.md)', () => {
    for (let i = 0; i < 20; i++) {
      const fp = generateFingerprint({ seed: `spoof-default-${i}` });
      expect(fp.webglSpoofingMode).toBe('spoof');
      expect(fp.serviceWorkerMode).toBe('disabled');
    }
  });

  it('defaults geolocation/permissions to real/real (off) and carries a coordinate coherent with the picked locale/timezone, not an arbitrary point', () => {
    for (let i = 0; i < 20; i++) {
      const fp = generateFingerprint({ seed: `geo-${i}` });
      expect(fp.geolocationMode).toBe('real');
      expect(fp.permissionsMode).toBe('real');
      const matchingLocale = LOCALE_PROFILES.find((l) => l.locale === fp.locale && l.timezone === fp.timezone);
      expect(matchingLocale, `no LOCALE_PROFILE matched locale=${fp.locale} timezone=${fp.timezone}`).toBeTruthy();
      expect(fp.geolocationLatitude).toBe(matchingLocale!.latitude);
      expect(fp.geolocationLongitude).toBe(matchingLocale!.longitude);
    }
  });
});

describe('fingerprint generator explicit field overrides', () => {
  it('applies a valid osVersion override for the resolved OS', () => {
    const fp = generateFingerprint({ seed: 'win-osver', os: 'windows', osVersion: '11.0' });
    expect(fp.osVersion).toBe('11.0');
  });

  it('ignores an osVersion override that does not belong to the resolved OS', () => {
    const fp = generateFingerprint({ seed: 'win-osver-foreign', os: 'windows', osVersion: '15.1' });
    expect(fp.osVersion).not.toBe('15.1');
    expect(['10.0', '11.0']).toContain(fp.osVersion);
  });

  it('applies a browserVersion override regardless of OS', () => {
    const fp = generateFingerprint({ seed: 'browser-ver', os: 'linux', browserVersion: '126.0.0.0' });
    expect(fp.browserVersion).toBe('126.0.0.0');
    expect(fp.userAgent).toContain('Chrome/126.0.0.0');
  });

  it('applies a valid screen resolution override', () => {
    const fp = generateFingerprint({ seed: 'screen-ok', os: 'macos', screenWidth: 2560, screenHeight: 1600 });
    expect(fp.screenWidth).toBe(2560);
    expect(fp.screenHeight).toBe(1600);
  });

  it('ignores a screen override that is not one of the resolved OS options', () => {
    const fp = generateFingerprint({ seed: 'screen-foreign', os: 'macos', screenWidth: 1366, screenHeight: 768 });
    expect(fp.screenWidth).not.toBe(1366);
  });

  it('applies a valid hardwareConcurrency override', () => {
    const fp = generateFingerprint({ seed: 'cpu-ok', os: 'linux', hardwareConcurrency: 8 });
    expect(fp.hardwareConcurrency).toBe(8);
  });

  it('ignores a hardwareConcurrency override outside the resolved OS options', () => {
    const fp = generateFingerprint({ seed: 'cpu-foreign', os: 'linux', hardwareConcurrency: 32 });
    expect(fp.hardwareConcurrency).not.toBe(32);
    expect([4, 8]).toContain(fp.hardwareConcurrency);
  });

  it('applies a valid deviceMemory override', () => {
    const fp = generateFingerprint({ seed: 'ram-ok', os: 'windows', deviceMemory: 32 });
    expect(fp.deviceMemory).toBe(32);
  });

  it('ignores a deviceMemory override outside the resolved OS options', () => {
    const fp = generateFingerprint({ seed: 'ram-foreign', os: 'macos', deviceMemory: 32 });
    expect(fp.deviceMemory).not.toBe(32);
    expect([8, 16]).toContain(fp.deviceMemory);
  });

  it('applies a valid webglVendor/webglRenderer pair override', () => {
    const fp = generateFingerprint({
      seed: 'gpu-ok',
      os: 'windows',
      webglVendor: 'Google Inc. (AMD)',
      webglRenderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)',
    });
    expect(fp.webglVendor).toBe('Google Inc. (AMD)');
    expect(fp.webglRenderer).toBe('ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)');
  });

  it('ignores a GPU override that does not belong to the resolved OS (no Apple GPU on Windows)', () => {
    const fp = generateFingerprint({
      seed: 'gpu-foreign',
      os: 'windows',
      webglVendor: 'Google Inc. (Apple)',
      webglRenderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)',
    });
    expect(fp.webglVendor).not.toBe('Google Inc. (Apple)');
  });

  it('still produces a fingerprint that passes its own validator when overrides are combined', () => {
    const fp = generateFingerprint({
      seed: 'combo-ok',
      os: 'windows',
      osVersion: '11.0',
      hardwareConcurrency: 16,
      deviceMemory: 32,
      screenWidth: 2560,
      screenHeight: 1440,
      webglVendor: 'Google Inc. (NVIDIA)',
      webglRenderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
    });
    const result = validateFingerprint(fp);
    expect(result.errors, JSON.stringify({ fp, result })).toEqual([]);
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

  it('does NOT warn about portrait orientation (width < height) on a mobile profile — that is the normal case', () => {
    const fp = generateFingerprint({ seed: 'android-portrait', os: 'android' });
    expect(fp.screenWidth).toBeLessThan(fp.screenHeight);
    const result = validateFingerprint(fp);
    expect(result.warnings.some((w) => w.includes('unusual for a desktop profile'))).toBe(false);
  });

  it('DOES still warn about portrait orientation on a desktop profile', () => {
    const fp = generateFingerprint({ seed: 'win-portrait', os: 'windows' });
    const portrait = { ...fp, screenWidth: 1080, screenHeight: 1920 };
    const result = validateFingerprint(portrait);
    expect(result.warnings.some((w) => w.includes('unusual for a desktop profile'))).toBe(true);
  });

  it('accepts an Apple GPU renderer on an ios profile (unlike every other non-macOS OS)', () => {
    const fp = generateFingerprint({ seed: 'ios-apple-gpu', os: 'ios' });
    const result = validateFingerprint(fp);
    expect(result.errors).toEqual([]);
  });

  it('rejects an Apple GPU renderer on an android profile — only macos/ios are allowed to reference Apple', () => {
    const fp = generateFingerprint({ seed: 'android-fake-apple', os: 'android' });
    const broken = { ...fp, webglRenderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' };
    const result = validateFingerprint(broken);
    expect(result.valid).toBe(false);
  });

  it('warns when a real mobile OS reports maxTouchPoints: 0 (no touchscreen is implausible on a phone)', () => {
    const fp = generateFingerprint({ seed: 'android-no-touch', os: 'android' });
    const broken = { ...fp, maxTouchPoints: 0 };
    const result = validateFingerprint(broken);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('warns when a desktop OS reports a nonzero maxTouchPoints', () => {
    const fp = generateFingerprint({ seed: 'win-fake-touch', os: 'windows' });
    const broken = { ...fp, maxTouchPoints: 5 };
    const result = validateFingerprint(broken);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('rejects a wrong platform string for android/ios, same as every other OS', () => {
    const androidFp = generateFingerprint({ seed: 'android-wrong-platform', os: 'android' });
    expect(validateFingerprint({ ...androidFp, platform: 'Win32' }).valid).toBe(false);

    const iosFp = generateFingerprint({ seed: 'ios-wrong-platform', os: 'ios' });
    expect(validateFingerprint({ ...iosFp, platform: 'MacIntel' }).valid).toBe(false);
  });
});
