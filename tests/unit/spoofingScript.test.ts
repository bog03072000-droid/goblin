import { describe, it, expect } from 'vitest';
import { buildFakeMediaDevices, buildSpoofingScript, type SpoofableFingerprint } from '../../src/main/browser/spoofingScript';

function baseFp(overrides: Partial<SpoofableFingerprint> = {}): SpoofableFingerprint {
  return {
    seed: 'profile-seed-abc',
    canvasMode: 'off',
    audioMode: 'off',
    deviceMemory: 8,
    webglSpoofingMode: 'off',
    webglVendor: 'Google Inc. (Intel)',
    webglRenderer: 'ANGLE (Intel, Intel(R) UHD Graphics)',
    fontsMode: 'system',
    mediaDevicesMode: 'real',
    serviceWorkerMode: 'real',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
    platform: 'Win32',
    hardwareConcurrency: 8,
    ...overrides,
  };
}

describe('buildFakeMediaDevices', () => {
  it('is deterministic — the same seed always produces the same device list', () => {
    const a = buildFakeMediaDevices('same-seed');
    const b = buildFakeMediaDevices('same-seed');
    expect(a).toEqual(b);
  });

  it('produces different device lists for different seeds', () => {
    const a = buildFakeMediaDevices('seed-one');
    const b = buildFakeMediaDevices('seed-two');
    expect(a).not.toEqual(b);
  });

  it('always includes at least one audio input and one audio output', () => {
    for (const seed of ['s1', 's2', 's3', 's4', 's5']) {
      const devices = buildFakeMediaDevices(seed);
      expect(devices.some((d) => d.kind === 'audioinput')).toBe(true);
      expect(devices.some((d) => d.kind === 'audiooutput')).toBe(true);
    }
  });

  it('never fabricates a device label (labels require permission in a real browser)', () => {
    const devices = buildFakeMediaDevices('label-check');
    expect(devices.every((d) => d.label === '')).toBe(true);
  });
});

describe('buildSpoofingScript', () => {
  it('includes the canvas noise patch only when canvasMode is "noise"', () => {
    expect(buildSpoofingScript(baseFp({ canvasMode: 'off' }))).not.toContain('patchCanvas');
    expect(buildSpoofingScript(baseFp({ canvasMode: 'noise' }))).toContain('patchCanvas');
  });

  it('includes the audio noise patch only when audioMode is "noise"', () => {
    expect(buildSpoofingScript(baseFp({ audioMode: 'off' }))).not.toContain('patchAudio');
    expect(buildSpoofingScript(baseFp({ audioMode: 'noise' }))).toContain('patchAudio');
  });

  it('always applies deviceMemory — there is no on/off mode for it', () => {
    const script = buildSpoofingScript(baseFp({ deviceMemory: 16 }));
    expect(script).toContain("'deviceMemory'");
    expect(script).toContain('16');
  });

  it('includes the WebGL override only when webglSpoofingMode is "spoof", and embeds the configured strings', () => {
    const off = buildSpoofingScript(baseFp({ webglSpoofingMode: 'off' }));
    expect(off).not.toContain('patchWebGL');

    const spoofed = buildSpoofingScript(
      baseFp({ webglSpoofingMode: 'spoof', webglVendor: 'Fake Vendor Inc.', webglRenderer: 'Fake Renderer 9000' }),
    );
    expect(spoofed).toContain('patchWebGL');
    expect(spoofed).toContain('Fake Vendor Inc.');
    expect(spoofed).toContain('Fake Renderer 9000');
  });

  it('includes the Service Worker deletion only when serviceWorkerMode is "disabled"', () => {
    expect(buildSpoofingScript(baseFp({ serviceWorkerMode: 'real' }))).not.toContain('disableServiceWorker');
    expect(buildSpoofingScript(baseFp({ serviceWorkerMode: 'disabled' }))).toContain('disableServiceWorker');
  });

  it('the iframe-WebGL-propagation patch is ONLY ever included when BOTH webglSpoofingMode is "spoof" AND serviceWorkerMode is "disabled" — never on its own (see docs/FINGERPRINT_AUDIT.md\'s "Seventh attempt": enabling it alone creates a new, real CreepJS-detectable mismatch)', () => {
    const neither = buildSpoofingScript(baseFp({ webglSpoofingMode: 'off', serviceWorkerMode: 'real' }));
    expect(neither).not.toContain('propagateWebglToIframes');

    const webglOnly = buildSpoofingScript(baseFp({ webglSpoofingMode: 'spoof', serviceWorkerMode: 'real' }));
    expect(webglOnly).not.toContain('propagateWebglToIframes');

    const swOnly = buildSpoofingScript(baseFp({ webglSpoofingMode: 'off', serviceWorkerMode: 'disabled' }));
    expect(swOnly).not.toContain('propagateWebglToIframes');

    const both = buildSpoofingScript(baseFp({ webglSpoofingMode: 'spoof', serviceWorkerMode: 'disabled' }));
    expect(both).toContain('propagateWebglToIframes');
  });

  it('includes the fonts restriction only when fontsMode is "restricted"', () => {
    expect(buildSpoofingScript(baseFp({ fontsMode: 'system' }))).not.toContain('patchFonts');
    expect(buildSpoofingScript(baseFp({ fontsMode: 'restricted' }))).toContain('patchFonts');
  });

  it('includes the media devices override only when mediaDevicesMode is "hidden", using the same deterministic device list', () => {
    expect(buildSpoofingScript(baseFp({ mediaDevicesMode: 'real' }))).not.toContain('patchMediaDevices');

    const script = buildSpoofingScript(baseFp({ mediaDevicesMode: 'hidden', seed: 'device-seed' }));
    expect(script).toContain('patchMediaDevices');
    const expectedDeviceId = buildFakeMediaDevices('device-seed')[0]!.deviceId;
    expect(script).toContain(expectedDeviceId);
  });

  it('produces a self-invoking, syntactically closed script (a smoke check against a malformed template)', () => {
    const script = buildSpoofingScript(
      baseFp({ canvasMode: 'noise', audioMode: 'noise', webglSpoofingMode: 'spoof', fontsMode: 'restricted', mediaDevicesMode: 'hidden' }),
    );
    expect(script.trim().startsWith('(function () {')).toBe(true);
    expect(script.trim().endsWith('})();')).toBe(true);
    // Parseable as a function body — throws a SyntaxError immediately if the
    // template produced unbalanced braces/parens.
    expect(() => new Function(script)).not.toThrow();
  });
});
