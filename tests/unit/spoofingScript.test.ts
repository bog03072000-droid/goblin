import { describe, it, expect } from 'vitest';
import vm from 'node:vm';
import { buildFakeMediaDevices, buildSpoofingScript, type SpoofableFingerprint } from '../../src/main/browser/spoofingScript';

/**
 * Executes a generated spoofing script against a mocked `self` inside a
 * completely separate V8 realm (`vm.createContext`), never the real Node
 * process's own `Function.prototype` — this script's toString-masking
 * install patches `Function.prototype.toString` globally within whatever
 * realm it runs in, and doing that against the *real* process-wide
 * `Function.prototype` from inside a test would leak into every other test
 * in the suite (stack traces, snapshot diffing, coverage instrumentation,
 * anything else that happens to call `.toString()` on a function for the
 * rest of the process's life). A fresh vm context gets its own independent
 * `Function`/`Object`/`Proxy`/`WeakMap`, so patching "the" `Function.prototype`
 * there only ever affects that throwaway realm.
 *
/** Shape of the mocked `self` this sandbox constructs — just enough of each
 * API's surface (a `.prototype` object, or a bare function) for the
 * spoofing script's own `if (proto) {...}`/`typeof ... !== 'undefined'`
 * guards to take the "patch it" branch, never actually invoked. */
interface SandboxSelf {
  CanvasRenderingContext2D: { prototype: { getImageData: () => void } };
  HTMLCanvasElement: { prototype: { toDataURL: () => void } };
  OffscreenCanvasRenderingContext2D: { prototype: { getImageData: () => void } };
  AudioBuffer: { prototype: { getChannelData: () => void } };
  WebGLRenderingContext: { prototype: { getParameter: () => void } };
  WebGL2RenderingContext: { prototype: { getParameter: () => void } };
  document: { fonts: { check: () => void } };
  navigator: {
    fonts: { query: () => void };
    mediaDevices: { enumerateDevices: () => void };
    serviceWorker: Record<string, never>;
  };
  Worker: () => void;
  SharedWorker: () => void;
}

/**
 * Returns the mocked `self` object (from inside the sandbox) so assertions
 * can read back `.toString()` on whatever the script patched.
 */
function runSpoofingScriptInSandbox(script: string): SandboxSelf {
  const setup = `
    var self = {
      CanvasRenderingContext2D: { prototype: { getImageData: function origGetImageData() {} } },
      HTMLCanvasElement: { prototype: { toDataURL: function origToDataURL() {} } },
      OffscreenCanvasRenderingContext2D: { prototype: { getImageData: function origOffGetImageData() {} } },
      AudioBuffer: { prototype: { getChannelData: function origGetChannelData() {} } },
      WebGLRenderingContext: { prototype: { getParameter: function origGetParameter1() {} } },
      WebGL2RenderingContext: { prototype: { getParameter: function origGetParameter2() {} } },
      document: { fonts: { check: function origCheck() {} } },
      navigator: {
        fonts: { query: function origQuery() {} },
        mediaDevices: { enumerateDevices: function origEnumerate() {} },
        serviceWorker: {},
      },
      Worker: function Worker() {},
      SharedWorker: function SharedWorker() {},
    };
  `;
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);
  vm.runInContext(setup + '\n' + script, sandbox);
  return sandbox['self'] as SandboxSelf;
}

const NATIVE = (name: string): string => `function ${name}() { [native code] }`;

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
    maxTouchPoints: 0,
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

  it('always applies maxTouchPoints — there is no on/off mode for it, same as deviceMemory', () => {
    const desktop = buildSpoofingScript(baseFp({ maxTouchPoints: 0 }));
    expect(desktop).toContain("'maxTouchPoints'");
    const mobile = buildSpoofingScript(baseFp({ maxTouchPoints: 5 }));
    expect(mobile).toContain("'maxTouchPoints'");
    expect(mobile).toContain('5');
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

describe('Function.prototype.toString masking', () => {
  const fp = baseFp({
    canvasMode: 'noise',
    audioMode: 'noise',
    webglSpoofingMode: 'spoof',
    fontsMode: 'restricted',
    mediaDevicesMode: 'hidden',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0',
    platform: 'MacIntel',
    hardwareConcurrency: 4,
    deviceMemory: 8,
    maxTouchPoints: 0,
  });
  const self = runSpoofingScriptInSandbox(buildSpoofingScript(fp));

  it('masks the Canvas getImageData/toDataURL overrides as native code', () => {
    expect(self['CanvasRenderingContext2D'].prototype.getImageData.toString()).toBe(NATIVE('getImageData'));
    expect(self['HTMLCanvasElement'].prototype.toDataURL.toString()).toBe(NATIVE('toDataURL'));
    expect(self['OffscreenCanvasRenderingContext2D'].prototype.getImageData.toString()).toBe(NATIVE('getImageData'));
  });

  it('masks the AudioBuffer.getChannelData override as native code', () => {
    expect(self['AudioBuffer'].prototype.getChannelData.toString()).toBe(NATIVE('getChannelData'));
  });

  it('masks the WebGL(2) getParameter override as native code on both prototypes', () => {
    expect(self['WebGLRenderingContext'].prototype.getParameter.toString()).toBe(NATIVE('getParameter'));
    expect(self['WebGL2RenderingContext'].prototype.getParameter.toString()).toBe(NATIVE('getParameter'));
  });

  it('masks the fonts.check/fonts.query overrides as native code', () => {
    expect(self['document'].fonts.check.toString()).toBe(NATIVE('check'));
    expect(self['navigator'].fonts.query.toString()).toBe(NATIVE('query'));
  });

  it('masks the mediaDevices.enumerateDevices override as native code', () => {
    expect(self['navigator'].mediaDevices.enumerateDevices.toString()).toBe(NATIVE('enumerateDevices'));
  });

  it('masks the Worker/SharedWorker constructor wrappers as native code', () => {
    expect(self['Worker'].toString()).toBe(NATIVE('Worker'));
    expect(self['SharedWorker'].toString()).toBe(NATIVE('SharedWorker'));
  });

  it('masks each navigator identity getter with the real V8 native-accessor format ("function get X() { [native code] }")', () => {
    const names = ['userAgent', 'platform', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints'];
    for (const name of names) {
      const getter = Object.getOwnPropertyDescriptor(self['navigator'], name)?.get;
      expect(getter, `expected a getter for navigator.${name}`).toBeTypeOf('function');
      expect(getter!.toString()).toBe(`function get ${name}() { [native code] }`);
    }
  });

  it('is self-consistent: Function.prototype.toString.toString() itself also looks native, not showing the mask\'s own source', () => {
    const src = `
      var __result = Function.prototype.toString.toString();
    `;
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    vm.runInContext(
      `
      var self = { CanvasRenderingContext2D: { prototype: {} } };
      ${buildSpoofingScript(fp)}
      ${src}
      `,
      sandbox,
    );
    const result = sandbox['__result'] as string;
    expect(result).not.toContain('__pfFnNames');
    expect(result).not.toContain('proxiedToString');
    expect(result.includes('[native code]')).toBe(true);
  });

  it('leaves an unmarked, ordinary function reporting its own real source (the mask only ever intercepts registered overrides)', () => {
    const src = `
      var self = { CanvasRenderingContext2D: { prototype: {} } };
      ${buildSpoofingScript(fp)}
      function ordinaryFunction() { return 42; }
      var __result = ordinaryFunction.toString();
    `;
    const sandbox: Record<string, unknown> = {};
    vm.createContext(sandbox);
    vm.runInContext(src, sandbox);
    expect(sandbox['__result']).toContain('return 42');
  });
});
