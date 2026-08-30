import type { Fingerprint } from '../../shared/schemas/fingerprint';
import { createSeededRandom, pick } from '../fingerprint/seededRandom';

export interface FakeMediaDevice {
  deviceId: string;
  kind: 'audioinput' | 'audiooutput' | 'videoinput';
  label: string;
  groupId: string;
}

/** Deterministic per-profile device list — same seed always produces the same
 * count and kinds, different seeds produce different ones. Generated
 * server-side (reusing the same seeded PRNG as the rest of fingerprint
 * generation) rather than in the injected browser script, so it's a plain,
 * independently unit-testable function with no browser required. */
export function buildFakeMediaDevices(seed: string): FakeMediaDevice[] {
  const rng = createSeededRandom(`${seed}:mediaDevices`);
  const audioInputs = 1 + Math.floor(rng() * 2); // 1-2
  const audioOutputs = 1 + Math.floor(rng() * 2); // 1-2
  const videoInputs = pick(rng, [0, 1, 1, 1]); // usually one webcam, sometimes none
  const groupId = `grp-${seed.slice(0, 8)}`;
  const devices: FakeMediaDevice[] = [];
  for (let i = 0; i < audioInputs; i++) {
    devices.push({ deviceId: `ai-${seed.slice(0, 6)}-${i}`, kind: 'audioinput', label: '', groupId });
  }
  for (let i = 0; i < audioOutputs; i++) {
    devices.push({ deviceId: `ao-${seed.slice(0, 6)}-${i}`, kind: 'audiooutput', label: '', groupId });
  }
  for (let i = 0; i < videoInputs; i++) {
    devices.push({ deviceId: `vi-${seed.slice(0, 6)}-${i}`, kind: 'videoinput', label: '', groupId });
  }
  return devices;
}

const RESTRICTED_FONT_ALLOWLIST = ['Arial', 'Times New Roman', 'Courier New', 'Segoe UI', 'Verdana'];

/**
 * Builds a JS source string injected via CDP `Page.addScriptToEvaluateOnNewDocument`
 * — the same category of mechanism (native Chromium DevTools Protocol, not a
 * preload/contextBridge world) already used for the enforced fields in
 * fingerprintEnforcement.ts, so this runs in the page's own MAIN world before
 * any of its own scripts, exactly like a real anti-detect browser's own
 * "evaluate on new document" approach — not a same-world monkeypatch racing
 * the page's own code.
 *
 * Canvas/Audio noise is *seeded*, not "crude global random noise": the noise
 * for a given canvas/audio buffer is a deterministic function of
 * (profile seed, content hash), so repeated reads of the *same* content in
 * the *same* profile always produce the *same* perturbed bytes, while two
 * different profiles reading identical content get different (but each
 * internally consistent) results. See docs/FINGERPRINT_AUDIT.md.
 */
export type SpoofableFingerprint = Pick<
  Fingerprint,
  'seed' | 'canvasMode' | 'audioMode' | 'deviceMemory' | 'webglSpoofingMode' | 'webglVendor' | 'webglRenderer' | 'fontsMode' | 'mediaDevicesMode'
>;

export function buildSpoofingScript(fp: SpoofableFingerprint): string {
  const parts: string[] = [];

  // Shared seeded PRNG (mulberry32) + a cheap content hash, inlined once.
  parts.push(`
(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) { h = (Math.imul(31, h) + s.charCodeAt(i)) | 0; }
    return h >>> 0;
  }
  var PROFILE_SEED = ${JSON.stringify(fp.seed)};
  var profileHash = hashStr(PROFILE_SEED);
`);

  if (fp.canvasMode === 'noise') {
    parts.push(`
  (function patchCanvas() {
    function contentHash(data) {
      var h = 0;
      for (var i = 0; i < data.length; i += 97) { h = (Math.imul(31, h) + data[i]) | 0; }
      return h >>> 0;
    }
    function noisify(imageData) {
      var data = imageData.data;
      var rand = mulberry32((profileHash ^ contentHash(data)) >>> 0);
      for (var i = 0; i < data.length; i += 4) {
        data[i]     = Math.min(255, Math.max(0, data[i]     + (Math.floor(rand() * 3) - 1)));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + (Math.floor(rand() * 3) - 1)));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + (Math.floor(rand() * 3) - 1)));
      }
      return imageData;
    }
    var proto = window.CanvasRenderingContext2D && window.CanvasRenderingContext2D.prototype;
    if (proto) {
      var origGetImageData = proto.getImageData;
      proto.getImageData = function () {
        var result = origGetImageData.apply(this, arguments);
        return noisify(result);
      };
    }
    var canvasProto = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
    if (canvasProto) {
      var origToDataURL = canvasProto.toDataURL;
      canvasProto.toDataURL = function () {
        try {
          var ctx = this.getContext('2d');
          if (ctx) {
            var w = this.width, h = this.height;
            var imageData = noisify(ctx.getImageData(0, 0, w, h));
            var tmp = document.createElement('canvas');
            tmp.width = w; tmp.height = h;
            tmp.getContext('2d').putImageData(imageData, 0, 0);
            return origToDataURL.apply(tmp, arguments);
          }
        } catch (e) {}
        return origToDataURL.apply(this, arguments);
      };
    }
  })();
`);
  }

  if (fp.audioMode === 'noise') {
    parts.push(`
  (function patchAudio() {
    var proto = window.AudioBuffer && window.AudioBuffer.prototype;
    if (!proto) return;
    var orig = proto.getChannelData;
    proto.getChannelData = function (channel) {
      var data = orig.call(this, channel);
      var sampleHash = 0;
      for (var i = 0; i < data.length; i += 97) { sampleHash = (Math.imul(31, sampleHash) + Math.floor(data[i] * 1000)) | 0; }
      var rand = mulberry32((profileHash ^ (sampleHash >>> 0) ^ channel) >>> 0);
      for (var j = 0; j < data.length; j++) {
        data[j] = data[j] + (rand() - 0.5) * 0.0001;
      }
      return data;
    };
  })();
`);
  }

  // Device memory has no on/off mode — it's always a configured value with
  // no native override (see docs/FINGERPRINT_AUDIT.md Finding 3), so this is
  // the only way to apply it at all, unconditionally.
  parts.push(`
  try {
    Object.defineProperty(Navigator.prototype, 'deviceMemory', {
      get: function () { return ${JSON.stringify(fp.deviceMemory)}; },
      configurable: true,
    });
  } catch (e) {}
`);

  if (fp.webglSpoofingMode === 'spoof') {
    parts.push(`
  (function patchWebGL() {
    var VENDOR = ${JSON.stringify(fp.webglVendor)};
    var RENDERER = ${JSON.stringify(fp.webglRenderer)};
    function patch(proto) {
      if (!proto) return;
      var orig = proto.getParameter;
      proto.getParameter = function (param) {
        if (param === 37445) return VENDOR;   // UNMASKED_VENDOR_WEBGL
        if (param === 37446) return RENDERER; // UNMASKED_RENDERER_WEBGL
        return orig.call(this, param);
      };
    }
    patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
  })();
`);
  }

  if (fp.fontsMode === 'restricted') {
    // Honest partial coverage only — see docs/FINGERPRINT_AUDIT.md §Fonts.
    // This blocks document.fonts.check()/values() and the Local Font Access
    // API, NOT the far more common CSS-fallback-measurement technique
    // (rendering text in a candidate font and measuring layout), which has
    // no JS hook to intercept at all.
    parts.push(`
  (function patchFonts() {
    var ALLOW = ${JSON.stringify(RESTRICTED_FONT_ALLOWLIST)};
    try {
      if (document.fonts) {
        document.fonts.check = function (font) {
          return ALLOW.some(function (f) { return font.indexOf(f) !== -1; });
        };
      }
      if (navigator.fonts && navigator.fonts.query) {
        navigator.fonts.query = function () { return Promise.resolve([]); };
      }
    } catch (e) {}
  })();
`);
  }

  if (fp.mediaDevicesMode === 'hidden') {
    const devices = buildFakeMediaDevices(fp.seed);
    parts.push(`
  (function patchMediaDevices() {
    var FAKE = ${JSON.stringify(devices)};
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        navigator.mediaDevices.enumerateDevices = function () {
          return Promise.resolve(FAKE.map(function (d) {
            return { deviceId: d.deviceId, kind: d.kind, label: d.label, groupId: d.groupId, toJSON: function () { return this; } };
          }));
        };
      }
    } catch (e) {}
  })();
`);
  }

  parts.push('})();');
  return parts.join('\n');
}
