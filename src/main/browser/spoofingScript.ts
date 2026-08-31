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
 * Builds a JS source string injected into the page's MAIN world via a
 * preload script's classic "append a <script> element, then remove it"
 * technique (see diagnosticsPreload.ts) — NOT CDP anymore (see
 * docs/FINGERPRINT_AUDIT.md, "CDP footprint reduction" section, for why this
 * moved off `Page.addScriptToEvaluateOnNewDocument`).
 *
 * Written against `self`, not `window`, throughout — `self` refers to the
 * same global in a normal document AND inside a Worker/SharedWorker global
 * scope, which is what makes this exact script string reusable verbatim as
 * the Worker-context patch below (previously, before this stage, Worker/
 * SharedWorker/ServiceWorker contexts received NONE of these overrides at
 * all — a real leak confirmed via a live CreepJS scan, see the audit doc).
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
  | 'seed'
  | 'canvasMode'
  | 'audioMode'
  | 'deviceMemory'
  | 'webglSpoofingMode'
  | 'webglVendor'
  | 'webglRenderer'
  | 'fontsMode'
  | 'mediaDevicesMode'
  | 'userAgent'
  | 'platform'
  | 'hardwareConcurrency'
>;

/** The part of the script that patches THIS global scope's own
 * canvas/audio/webgl/navigator surface — shared verbatim between the main
 * document and every Worker/SharedWorker it spawns (see buildSpoofingScript). */
function buildCoreScript(fp: SpoofableFingerprint): string {
  const parts: string[] = [];

  parts.push(`
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
    var proto = self.CanvasRenderingContext2D && self.CanvasRenderingContext2D.prototype;
    if (proto) {
      var origGetImageData = proto.getImageData;
      proto.getImageData = function () {
        var result = origGetImageData.apply(this, arguments);
        return noisify(result);
      };
    }
    var canvasProto = self.HTMLCanvasElement && self.HTMLCanvasElement.prototype;
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
    // OffscreenCanvas exists in Worker global scopes (no HTMLCanvasElement
    // there) — same noise function, same seeded determinism.
    var offscreenProto = self.OffscreenCanvasRenderingContext2D && self.OffscreenCanvasRenderingContext2D.prototype;
    if (offscreenProto) {
      var origOffGetImageData = offscreenProto.getImageData;
      offscreenProto.getImageData = function () {
        var result = origOffGetImageData.apply(this, arguments);
        return noisify(result);
      };
    }
  })();
`);
  }

  if (fp.audioMode === 'noise') {
    parts.push(`
  (function patchAudio() {
    var proto = self.AudioBuffer && self.AudioBuffer.prototype;
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
    patch(self.WebGLRenderingContext && self.WebGLRenderingContext.prototype);
    patch(self.WebGL2RenderingContext && self.WebGL2RenderingContext.prototype);
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
      if (self.document && self.document.fonts) {
        self.document.fonts.check = function (font) {
          return ALLOW.some(function (f) { return font.indexOf(f) !== -1; });
        };
      }
      if (self.navigator && self.navigator.fonts && self.navigator.fonts.query) {
        self.navigator.fonts.query = function () { return Promise.resolve([]); };
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
      if (self.navigator && self.navigator.mediaDevices && self.navigator.mediaDevices.enumerateDevices) {
        self.navigator.mediaDevices.enumerateDevices = function () {
          return Promise.resolve(FAKE.map(function (d) {
            return { deviceId: d.deviceId, kind: d.kind, label: d.label, groupId: d.groupId, toJSON: function () { return this; } };
          }));
        };
      }
    } catch (e) {}
  })();
`);
  }

  // Navigator identity fields with no CDP coverage inside Worker/SharedWorker
  // scopes (CDP's Emulation.setUserAgentOverride/setHardwareConcurrencyOverride
  // only ever reach the main document — see docs/FINGERPRINT_AUDIT.md). For
  // the main document these values already match what CDP set (harmless,
  // redundant); for a Worker, this JS-level override is the ONLY thing that
  // sets them at all — that gap is exactly what a live CreepJS scan caught
  // (Worker reported the real host's Windows/NVIDIA identity while the main
  // document correctly reported the configured one).
  //
  // deviceMemory has no native override at all anywhere (see Finding 3) —
  // this getter is its only mechanism, unconditionally, same as before.
  parts.push(`
  (function overrideNavigatorIdentity() {
    if (!self.navigator) return;
    // Each property is its own try/catch: WorkerNavigator (unlike the main
    // document's Navigator) was found to throw on some of these — e.g.
    // 'platform' — while 'userAgent' succeeds, on this Chromium build. A
    // single shared try/catch around all four meant one throw silently
    // aborted the rest, leaving platform/hardwareConcurrency/deviceMemory
    // unset inside every Worker — a real bug caught by a live CreepJS scan
    // (the dedicated-Worker path reported the real host's Win32/16-core
    // values while userAgent alone was correctly overridden). Isolating
    // each call means a property this Chromium build won't let us redefine
    // fails on its own without taking the others down with it.
    try { Object.defineProperty(self.navigator, 'userAgent', { get: function () { return ${JSON.stringify(fp.userAgent)}; }, configurable: true }); } catch (e) {}
    try { Object.defineProperty(self.navigator, 'platform', { get: function () { return ${JSON.stringify(fp.platform)}; }, configurable: true }); } catch (e) {}
    try { Object.defineProperty(self.navigator, 'hardwareConcurrency', { get: function () { return ${JSON.stringify(fp.hardwareConcurrency)}; }, configurable: true }); } catch (e) {}
    try { Object.defineProperty(self.navigator, 'deviceMemory', { get: function () { return ${JSON.stringify(fp.deviceMemory)}; }, configurable: true }); } catch (e) {}
  })();
`);

  return parts.join('\n');
}

export function buildSpoofingScript(fp: SpoofableFingerprint): string {
  const core = buildCoreScript(fp);

  return `
(function () {
${core}

  // Propagate the exact same patches into every Worker/SharedWorker this
  // page spawns. new Worker()/new SharedWorker() are synchronous
  // constructors, so the original script source is fetched with a
  // synchronous XHR (works instantly against blob:/data: URLs and any
  // same-origin script — no real network wait) and re-served as a Blob URL
  // with our patch code prepended, so it runs first inside the worker's own
  // global scope, before any of the worker's own code.
  function wrapWorkerCtor(Original) {
    if (!Original) return Original;
    return function (scriptURL, options) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', scriptURL, false);
        xhr.send(null);
        var originalSrc = (xhr.status === 200 || xhr.status === 0) ? xhr.responseText : null;
        if (originalSrc === null) return new Original(scriptURL, options);
        var combined = ${JSON.stringify(core)} + '\\n' + originalSrc;
        var blobUrl = URL.createObjectURL(new Blob([combined], { type: 'application/javascript' }));
        return new Original(blobUrl, options);
      } catch (e) {
        return new Original(scriptURL, options);
      }
    };
  }
  try { if (typeof self.Worker !== 'undefined') self.Worker = wrapWorkerCtor(self.Worker); } catch (e) {}
  try { if (typeof self.SharedWorker !== 'undefined') self.SharedWorker = wrapWorkerCtor(self.SharedWorker); } catch (e) {}

  // Best-effort only: Service Worker registration is async by nature and
  // Chromium restricts acceptable script origins for it more strictly than
  // for dedicated/shared workers (a blob: URL is not reliably accepted for
  // navigator.serviceWorker.register across Chromium versions) — this is
  // documented as a known, unresolved gap in docs/FINGERPRINT_AUDIT.md
  // rather than silently claimed as covered.
  try {
    if (self.navigator && self.navigator.serviceWorker && self.navigator.serviceWorker.register) {
      var origRegister = self.navigator.serviceWorker.register.bind(self.navigator.serviceWorker);
      self.navigator.serviceWorker.register = function (scriptURL, options) {
        return fetch(scriptURL)
          .then(function (r) { return r.text(); })
          .then(function (originalSrc) {
            var combined = ${JSON.stringify(core)} + '\\n' + originalSrc;
            var blobUrl = URL.createObjectURL(new Blob([combined], { type: 'application/javascript' }));
            return origRegister(blobUrl, options);
          })
          .catch(function () { return origRegister(scriptURL, options); });
      };
    }
  } catch (e) {}
})();
`;
}
