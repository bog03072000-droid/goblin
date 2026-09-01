# Fingerprint Reality Audit

**Method.** Every claim below is backed by one of: (a) an automated E2E test in
`tests/e2e/fingerprintEnforcement.spec.ts` that starts a real per-profile
browser process and reads its actual `navigator`/`screen`/`Intl`/WebGL/
`RTCPeerConnection` state, or (b) an empirical one-off script run against this
project's actual Electron 32.3.3 / Chromium 128.0.6613.186 build during this
audit (documented inline below, then discarded — not kept in the repo). No
classification in this document is based on reading Chromium documentation or
memory of how a similar feature worked in a different Electron version.
Nothing here was verified by editing the diagnostic page to display what we
wanted it to say.

## Classification key

- **A** — Actually applied and verified by the E2E test reading the real browser.
- **B** — Applied via a real mechanism but only partially verifiable (e.g. the
  mechanism is confirmed engaged, but its effect can't be read back from page JS).
- **C** — Stored in the data model and validated for coherence, but not applied
  to the actual browser process.
- **D** — Not implemented. Either no reliable Chromium/Electron-native
  mechanism exists, or (for two properties) not yet in the data model at all.

## Final summary table (this stage)

The table below is the flow every field is actually checked against:
**Configured** (what's stored per-profile) → **Chromium startup value**
(what CDP/JS-override actually sets before the page loads) →
**browser-observed value** (what `navigator`/`screen`/`WebGL`/etc. actually
report once the page runs). "E2E Verified" means an automated test drives a
real per-profile Electron/Chromium process and reads the live value back —
never a mocked browser, never a hand-edited diagnostics page.

| Feature | Supported | Actually Applied | E2E Verified | Notes |
|---|---|---|---|---|
| User-Agent | Yes | Yes, always | Yes | CDP `Emulation.setUserAgentOverride`. |
| Platform | Yes | Yes, always | Yes | Same CDP call, `platform` field. |
| Locale | Yes | Yes, always | Yes | CDP `acceptLanguage` (session-level `--lang` alone was found to leak host languages — not relied on, see Finding 1). |
| Languages | Yes | Yes, always | Yes | Same CDP `acceptLanguage`, full list. |
| Timezone | Yes | Yes, always | Yes | `TZ` env var on the per-profile child process; `Intl` resolves it directly. |
| Screen (width/height) | Yes | Yes, always | Yes | CDP `Emulation.setDeviceMetricsOverride`. |
| Viewport | Yes (by construction) | Yes | Yes (indirect) | Real `BrowserWindow` size; deliberately *not* CDP-overridden so it stays decoupled from the claimed screen size (Finding 2) — no visual distortion. |
| Device Pixel Ratio | Yes | Yes, always | Yes | Same CDP `Emulation.setDeviceMetricsOverride` call. |
| Hardware Concurrency | Yes | Yes, always | Yes | CDP `Emulation.setHardwareConcurrencyOverride`. |
| Device Memory | Yes | Yes, always | Yes | No CDP method exists for this (Finding 3) — a JS-level `Navigator.prototype.deviceMemory` getter override, injected via CDP `Page.addScriptToEvaluateOnNewDocument`, applied unconditionally. |
| Canvas | Yes | Yes, on by default (`canvasMode: 'noise'`) | Yes | Seeded per-profile noise (±1 on RGB channels) on `toDataURL()`/`getImageData()` — same-content-same-profile is byte-deterministic (tested), different profiles diverge on identical content (tested). |
| Audio | Yes | Yes, on by default (`audioMode: 'noise'`) | Partial | Seeded per-profile noise on `AudioBuffer.getChannelData()` — override-installed is directly verified; the noise's numeric effect isn't independently re-derived by the test (would require re-implementing the seeded-PRNG math in the test itself, not currently done). |
| WebGL (vendor/renderer) | Yes | **On by default since this audit stage** (`webglSpoofingMode: 'spoof'`), still a per-profile opt-out toggle | Yes on the main document/dedicated/shared Worker — **confirmed NOT reached inside a Service Worker** (see §Service Workers' later-stage addendum: a real CreepJS run leaks the true GPU through this exact path despite spoofing being on) | Off (opted out): honestly reports the real GPU/ANGLE string (asserted `NOT_IMPLEMENTED`, never a coincidental false PASS). On (default): `getParameter()` override on both `WebGL(2)RenderingContext.prototype`, intercepting only `UNMASKED_VENDOR_WEBGL`/`UNMASKED_RENDERER_WEBGL` — verified this stage to (a) actually apply the configured strings and (b) leave an unrelated real capability (`MAX_TEXTURE_SIZE`) unaffected, i.e. WebGL keeps working normally for real content, and (c) does **not** apply inside a Service Worker, root-caused and documented below rather than left as a silent gap. |
| Media Devices | Yes | Opt-in, off by default (`mediaDevicesMode: 'real'`) | Yes | Off: real device enumeration (verified empirically: real inputs/outputs, not fabricated). On: `enumerateDevices()` returns a seeded synthetic list structurally distinguishable as fake by the diagnostics page's own check — not just trusting the mode flag. |
| Fonts | Yes | Opt-in, off by default (`fontsMode: 'system'`); **partial even when on** | Yes | On: blocks `document.fonts.check()` and the Local Font Access API only. Does **not** block CSS-fallback-width-measurement font detection — re-investigated this stage (see §Fonts below), no clean fix exists without a Chromium patch or breaking real page layout; kept as-is and documented rather than silently claimed as full coverage. |

The detailed per-field mechanism, empirical findings, and A/B/C/D grading
(a stricter, more granular classification than the table above) follow below.

## Reality matrix

| Property | Configured | Applied | Observed by diagnostics page | Validated (coherence) | Tested (E2E) | Implementation method | Class |
|---|---|---|---|---|---|---|---|
| User-Agent | ✅ | ✅ | ✅ real value | ✅ | ✅ | `session.setUserAgent()` + CDP `Emulation.setUserAgentOverride` | **A** |
| Platform (`navigator.platform`) | ✅ | ✅ | ✅ real value | ✅ | ✅ | CDP `Emulation.setUserAgentOverride({platform})` | **A** |
| OS (drives platform/UA/GPU bundle) | ✅ | ✅ (via platform+UA) | — (not directly readable) | ✅ | indirectly | Generator picks one coherent `PlatformProfile` bundle | **A** |
| Locale (`navigator.language`) | ✅ | ✅ | ✅ real value | ✅ | ✅ | CDP `acceptLanguage` (see Finding 1) | **A** |
| Languages (`navigator.languages`) | ✅ | ✅ | ✅ real value | ✅ | ✅ | CDP `acceptLanguage` (comma list) | **A** |
| Timezone (`Intl…timeZone`) | ✅ | ✅ | ✅ real value | ✅ (warns on unusual pairing) | ✅ | `TZ` env var on the per-profile child process | **A** |
| Screen width/height | ✅ | ✅ | ✅ real value | ✅ | ✅ | CDP `Emulation.setDeviceMetricsOverride({screenWidth, screenHeight})` | **A** |
| Viewport (`window.innerWidth/Height`) | n/a (real window size is the viewport) | ✅ by construction | ✅ | n/a | manual | `BrowserWindow` sized directly; deliberately **not** overridden via CDP (see Finding 2) | **A** |
| devicePixelRatio | ✅ (`deviceScaleFactor`) | ✅ | ✅ real value | ✅ | ✅ | CDP `Emulation.setDeviceMetricsOverride({deviceScaleFactor})` | **A** |
| hardwareConcurrency | ✅ | ✅ | ✅ real value | ✅ | ✅ | CDP `Emulation.setHardwareConcurrencyOverride` | **A** |
| deviceMemory | ✅ | ✅ (unconditional) | ✅ configured value | ✅ (range only) | ✅ (asserts PASS) | `Navigator.prototype.deviceMemory` getter override, injected via CDP `Page.addScriptToEvaluateOnNewDocument` — see Finding 6 | **A** |
| WebGL vendor | ✅ | on by default (`webglSpoofingMode`, default `spoof` since this stage), per-profile opt-out | real GPU value if opted out **or if read from inside a real Service Worker** (see §Service Workers' later-stage addendum — confirmed leak path, not theoretical) | ✅ (plausibility only) | ✅ **both states on the main document** (off: asserts NOT_IMPLEMENTED; on/default: asserts PASS with a matching value, plus a real WebGL capability read to confirm compatibility); ✅ **Service Worker case added later this stage** (asserts the real, unpatched value — an honest NOT_IMPLEMENTED-style expectation, not a false PASS) | `getParameter()` override on `WebGL(2)RenderingContext.prototype`, same injection mechanism — on by default, see §WebGL spoofing; reaches dedicated/shared Workers via the same propagation as navigator fields, does **not** reach Service Workers, see §Service Workers | **B** on the main document/dedicated/shared Worker by default (→ **C** if opted out); **D** (not implemented, now proven not just assumed) specifically for the Service Worker path |
| WebGL renderer | ✅ | on by default (`webglSpoofingMode`, default `spoof` since this stage), per-profile opt-out | real GPU value if opted out **or if read from inside a real Service Worker** (same confirmed leak path as WebGL vendor) | ✅ (Apple-only-on-macOS check) | ✅ **both states on the main document** (same test as vendor); ✅ **Service Worker case added later this stage** | same as WebGL vendor | same grading as WebGL vendor |
| Canvas | ✅ (`canvasMode`, default `noise`) | ✅ | ✅ deterministic per-profile noise | schema only | ✅ (asserts APPLIED + determinism, cross-profile difference) | seeded noise on `toDataURL()`/`getImageData()`, injected via CDP main-world script — see §Canvas (implemented) | **B** |
| AudioContext | ✅ (`audioMode`, default `noise`) | ✅ | not read back numerically by diagnostics (override presence checked instead) | schema only | ✅ (asserts APPLIED — override installed) | seeded noise on `AudioBuffer.prototype.getChannelData`, same injection mechanism — see §Audio (implemented) | **B** |
| WebRTC | ✅ (`webrtcMode`) | ✅ (best available) | live ICE-candidate probe | n/a | ✅ | `webContents.setWebRTCIPHandlingPolicy()` (see Finding 5) | **B** |
| Fonts | ✅ (`fontsMode`, default `system`) | opt-in (`restricted` mode) | real fonts unless opted in | schema only | ✅ (asserts NOT_IMPLEMENTED by default) | `document.fonts.check`/`navigator.fonts.query` override to a fixed allow-list — partial coverage only, see §Fonts (implemented) | **C** (→ **B** when `restricted`) |
| Media devices | ✅ (`mediaDevicesMode`, default `real`) | opt-in (`hidden` mode) | ✅ real enumeration unless opted in | schema only | ✅ (asserts NOT_IMPLEMENTED by default) | `navigator.mediaDevices.enumerateDevices` override returning a seeded synthetic device list — see §Media devices (implemented) | **C** (→ **B** when `hidden`) |
| Permissions | — | ❌ | — | — | — | not in the data model at all yet | **D** |
| Geolocation | — | ❌ | — | — | — | not in the data model at all yet | **D** |

## Findings from empirical verification

**Finding 1 — the `--lang` Chromium switch leaks the host OS's real
languages.** Before this audit, locale/languages were set only via
`app.commandLine.appendSwitch('lang', locale)`. Tested directly: on this
Windows machine (OS languages: Ukrainian, English), launching with
`--lang=de-DE` produced `navigator.language = "de"` and
`navigator.languages = ["de", "uk", "en-US"]` — the host's real installed
languages leaked straight into the array. This is now fixed by using CDP
`Emulation.setUserAgentOverride({ acceptLanguage })` with the full configured
list instead, which produces exactly the configured list and nothing else
(verified: `acceptLanguage: 'fr-FR,fr'` → `navigator.languages = ["fr-FR", "fr"]`).
The `--lang` switch is still set (harmless, affects some Chromium UI strings)
but is no longer relied upon for navigator-level locale data.

**Finding 2 — `setDeviceMetricsOverride`'s `width`/`height` are decoupled from
`screenWidth`/`screenHeight`.** Passing `width: 0, height: 0` (Chromium's
"don't override" sentinel) leaves the real window viewport
(`window.innerWidth/innerHeight`) untouched while `screenWidth`/`screenHeight`
still override `screen.width/height` independently. Verified: with an actual
784×535 viewport, applying `{width:0, height:0, screenWidth:1920,
screenHeight:1080, deviceScaleFactor:2}` produced `screen.width === 1920`,
`screen.height === 1080`, `window.devicePixelRatio === 2`, while
`window.innerWidth/innerHeight` stayed at 784×535 — no visual distortion of
the actual browsing viewport. This is what makes it safe to claim an
arbitrary configured monitor resolution without breaking real page layout,
and is the intended distinction the audit brief draws between "physical
screen" and "browser viewport."

**Finding 3 — `Emulation.setDeviceMemoryOverride` does not exist.** Attempted
directly against this Chromium build; the CDP call is rejected with
`'Emulation.setDeviceMemoryOverride' wasn't found`. `navigator.deviceMemory`
is a real, bucketed reading of actual system RAM with no override mechanism
in stock Chromium. Confirmed D, not previously assumed.

**Finding 4 — no Chromium-native mechanism claims an arbitrary WebGL
vendor/renderer string.** `WEBGL_debug_renderer_info`'s
`UNMASKED_VENDOR_WEBGL`/`UNMASKED_RENDERER_WEBGL` reflect the real GPU driver
via ANGLE. There is no CDP Emulation method for this (unlike hardware
concurrency or device metrics). Forcing an arbitrary string would require
either a software rendering backend switch (`--use-gl=swiftshader`, which
changes the *real* renderer to a generic software one — not an arbitrary
configured string) or a JS-level `getParameter()` override, which the project
brief explicitly forbids presenting as production spoofing. Left as D;
diagnostics honestly shows the real GPU (verified: configured
`"Google Inc. (Intel)"` vs. observed `"Google Inc. (NVIDIA)"` on the dev
machine used for this audit — a real mismatch, correctly surfaced, not hidden).

**Finding 5 — `setWebRTCIPHandlingPolicy` is a `WebContents` method, not a
`Session` method, in this Electron version.** Older documentation/memory
suggested `session.setWebRTCIPHandlingPolicy`; grepping this project's actual
installed `electron.d.ts` shows it declared only on `WebContents` (confirmed
by TypeScript rejecting the `Session` call with TS2339). Implemented on the
webview's `WebContents` inside the `did-attach-webview` handler instead. This
is a real, first-party Chromium leak-protection feature (see BrowserLeaks),
not a homegrown one — but Chromium has no "fully disable WebRTC" policy, so
`webrtcMode: 'disabled'` maps to the same strongest-available
`disable_non_proxied_udp` policy as `'proxy-only'` rather than truly removing
`RTCPeerConnection`. This is graded **B**, not A, for exactly that reason.

The diagnostics page's WebRTC row runs a real ICE-candidate probe (opens an
`RTCPeerConnection` against a public STUN server, inspects actual candidates)
rather than trusting that the policy call succeeded. In this project's own
sandboxed dev environment the probe correctly reports `NOT_IMPLEMENTED` with
reason "no ICE candidates gathered — policy could not be exercised", because
no candidates were gathered — the honest outcome when the mechanism can't be
exercised, not a false `APPLIED`.

## Canvas, Audio, Fonts, and Media Devices — implemented this stage

The previous stage of this audit graded these D and described the required
future architecture: "a preload script scoped per-partition that wraps the
canvas 2D/WebGL read-back methods with a *deterministic, seeded* per-profile
noise function (keyed off the same seed already used for fingerprint
generation)". That architecture is now implemented, with one correction: a
**preload script cannot actually do this**, because both the manager window
and every profile webview run with `contextIsolation: true`, and a preload
script's `contextBridge` world is isolated from the page's own DOM
prototypes — `HTMLCanvasElement.prototype`, `AudioBuffer.prototype`, and
`WebGL(2)RenderingContext.prototype` in a preload script are *different
objects* from the ones the page's own scripts see. Patching them there has no
effect on the actual page.

**Finding 6 — CDP `Page.addScriptToEvaluateOnNewDocument` reaches the real
page world.** This is the same category of native Chromium mechanism as the
`Emulation.*` CDP calls used for User-Agent/screen/hardware-concurrency above
— not a homegrown injection hack. `wc.debugger.sendCommand('Page.enable')`
followed by `Page.addScriptToEvaluateOnNewDocument({source})` (implemented in
`injectSpoofingScript()`, `src/main/browser/fingerprintEnforcement.ts`)
registers a script that Chromium itself runs in the page's actual main
world, before any of the page's own `<script>` tags execute, on every future
navigation. This is the mechanism CDP-based automation tools use precisely
because it runs on the *browser* side of the isolation boundary, so it can
reach and monkeypatch the real `HTMLCanvasElement.prototype` etc. that page
scripts will subsequently see.

**Deterministic, seeded noise — not "crude global random noise".** The
project's design brief explicitly forbids the latter. The spoofing script
(`src/main/browser/spoofingScript.ts`, built once per profile from its
fingerprint row and injected as a JS source string) implements each override
as follows:

- **Canvas** — overrides `CanvasRenderingContext2D.prototype.getImageData`
  and `HTMLCanvasElement.prototype.toDataURL`. Reads the real pixel data
  first, computes a cheap content hash from those actual bytes, seeds a
  `mulberry32` PRNG with `hashStr(profile.seed) XOR contentHash`, then
  perturbs each RGB channel (not alpha) by at most ±1. Same profile + same
  canvas content → same seed → byte-identical output on every call within
  the session (verified by `canvasIsDeterministic()` in diagnostics.html,
  which draws the same content twice and asserts equality — and by the E2E
  test, which additionally asserts *different* profiles get *different*
  results for identical content). Off by default is not the case here —
  `canvasMode` already defaulted to `'noise'` in the generator before this
  stage; this stage made that existing default actually take effect.
- **Audio** — overrides `AudioBuffer.prototype.getChannelData`, adding
  `(rand() - 0.5) * 0.0001` per sample using the same seeded-PRNG pattern
  (profile seed XOR a hash of the buffer's own initial content). Same
  determinism property as Canvas.
- **Device Memory** — `Object.defineProperty(Navigator.prototype,
  'deviceMemory', {get: () => configuredValue})`. Unconditional (no on/off
  mode — there's nothing plausibility-sensitive about always reporting the
  profile's stored value), applied via the same injected script. This is the
  first genuinely-enforced fix for Finding 3 (no CDP-native mechanism exists,
  which remains true — this is a JS-level override, not a CDP Emulation call,
  and is graded A because it's unconditional and the diagnostics page
  verifies the real, configured value are equal every time).
- **Fonts** — overrides `document.fonts.check()` and (where present)
  `navigator.fonts.query()` to only ever report matches against a fixed
  five-font allow-list (`RESTRICTED_FONT_ALLOWLIST` in spoofingScript.ts:
  Arial, Times New Roman, Courier New, Segoe UI, Verdana), only when
  `fontsMode === 'restricted'` (default remains `'system'`, i.e. off).
  **Documented partial coverage**: this blocks the CSS Font Loading API and
  the permission-gated Local Font Access API, but does **not** block the far
  more common CSS-fallback-width-measurement technique (rendering text in a
  candidate font and measuring its width against a known fallback) — that
  technique reads real layout metrics from the actual installed system fonts
  and has no interception point reachable from page-world JS without
  rewriting Chromium's text-layout/shaping internals. The Fingerprint tab's
  hint text and this document both say so explicitly; the diagnostics page
  never claims more than "override installed", never "fonts fully hidden".
### Fonts — re-investigated this stage, no clean fix exists, kept as-is

Re-examined specifically to see whether the CSS-measurement gap above could
be closed without a Chromium patch or a fragile hack. It cannot, and the
reason is structural rather than a missing trick:

CSS-measurement font detection works by rendering the same string in a
candidate font (with a generic fallback appended, e.g. `"Candidate Font",
monospace`) and in the fallback alone, then comparing the two renders'
metrics — width via `CanvasRenderingContext2D.measureText()`, or
width/height via `element.getBoundingClientRect()` / `offsetWidth` /
`offsetHeight` / `getComputedStyle()`. If the candidate font is installed,
the metrics differ from the fallback-only render; if not, they're identical.
Blocking this detection technique means one of:

1. **Intercept every layout-measurement API** (`measureText`,
   `getBoundingClientRect`, `offsetWidth/Height`, `getClientRects`, computed
   style reads, and more) and lie about the numbers whenever a non-allow-
   listed font was requested. These are not niche APIs — they are used
   continuously by ordinary, legitimate page code (menus, tooltips,
   autosizing text, canvas-based UI, virtualized lists, editors) for reasons
   that have nothing to do with fingerprinting. Patching them to return
   fabricated values for arbitrary CSS `font-family` values would corrupt
   real page layout on a huge fraction of the sites this browser needs to
   work on — exactly the "fragile hack that breaks compatibility" this
   stage was told to avoid.
2. **Never let the requested font actually render**, i.e. force every
   `font-family` to resolve to one of a small allow-list at the
   text-shaping/rendering-engine level, regardless of what CSS asked for.
   This is what Tor Browser actually does — but it does it by *bundling* a
   fixed, cross-platform font set and configuring Chromium/Firefox's font
   matching to only ever resolve to that set, which is a build-time/
   engine-level decision, not something reachable from an
   injected page-world script. Doing the equivalent here would mean either
   patching Chromium itself (explicitly out of scope) or standing up a
   real per-profile isolated font directory at the OS level (a genuinely
   different, much larger feature, not a fix to the existing mechanism).

Neither option fits "clean fix, no Chromium modification, no fragile
hacks." **Decision: keep the current implementation as-is.** `fontsMode:
'restricted'` continues to block `document.fonts.check()` and the
Local Font Access API only, `fontsMode: 'system'` remains the default, and
both this document and the Fingerprint tab's own UI hint continue to state
the CSS-measurement gap explicitly rather than implying broader coverage
than actually exists.

- **Media devices** — overrides `navigator.mediaDevices.enumerateDevices()`
  to return a precomputed, seeded synthetic device list
  (`buildFakeMediaDevices()`, reusing the project's existing
  `createSeededRandom()`/`pick()` helpers from `seededRandom.ts` — same
  determinism guarantee as the rest of fingerprint generation), only when
  `mediaDevicesMode === 'hidden'` (default remains `'real'`). All labels are
  empty strings and device IDs are prefixed `ai-`/`ao-`/`vi-`, which the
  diagnostics page's `mediaDevicesLookFake()` check uses to verify the
  override is genuinely active rather than trusting the mode flag alone.
  This addresses the semantic gap the previous audit stage flagged (a
  Chromium flag like `--use-fake-device-for-media-stream` would replace real
  devices with **generic** synthetic ones — not a per-profile-*consistent*
  fake list, which is what "hidden" as a per-profile identity property
  actually requires).

## WebGL spoofing (on by default since this audit stage, still an opt-out toggle)

**This one is deliberately different from the other four.** `getParameter()`
interception on `WebGL(2)RenderingContext.prototype` is architecturally the
same injection mechanism as Canvas/Audio above, and is implemented
(`webglSpoofingMode: 'spoof'` in spoofingScript.ts intercepts parameter
`37445`/`37446`, i.e. `UNMASKED_VENDOR_WEBGL`/`UNMASKED_RENDERER_WEBGL`, and
returns the profile's stored `webglVendor`/`webglRenderer` strings instead of
the real ones). But unlike Canvas/Audio noise (a few LSBs of pixel/sample
perturbation that legitimate content never depends on) or the Device
Memory/Fonts/Media-Devices overrides (values pages read but essentially never
branch rendering logic on), **WebGL vendor/renderer strings are sometimes
read by real sites to select a rendering code path** — GPU-tier detection in
games, some map/3D renderers, and certain bot-detection/CAPTCHA systems key
behavior off the reported GPU string. Overriding it carries genuine
compatibility risk that the other four overrides don't.

Per the project's own stated resolution for exactly this situation, this is
shipped as a separate schema field (`webglSpoofingMode: z.enum(['off',
'spoof'])`, migration `003_webgl_spoofing_mode.sql`), with its own UI toggle
in the Fingerprint tab's Spoofing panel carrying an explicit warning banner
(`editor.fingerprint.spoofing.webglWarning`: *"Experimental — overrides a
real WebGL API used by some games, map renderers, and CAPTCHAs. May break
page compatibility."*, shown in both English and Ukrainian) whenever the
toggle is on. `webglVendor`/`webglRenderer` themselves are still generated
and stored per-profile as before (unchanged, still class **C** on their
own) — the field controls only whether the JS-level override is actually
installed. Turning it on is graded **B**, same category as Canvas/Audio,
since the diagnostics page can only verify "the override is installed and
returns the configured string", not that every possible WebGL-reading code
path on every real site sees a fully consistent picture — the same category
of partial-verifiability limitation as WebRTC's grade B.

**Default changed from `'off'` to `'spoof'` for new profiles, this audit
stage.** `generator.ts`'s `generateFingerprint()` now sets
`webglSpoofingMode: 'spoof'` for every newly generated fingerprint — a
critical-audit finding flagged this as "the single largest practical
detection gap": with the old `'off'` default, every profile a user created
without manually visiting the Fingerprint tab exposed the real host GPU
renderer (e.g. a real `NVIDIA GeForce RTX 4060`) regardless of how carefully
every other field was spoofed, which is exactly the kind of one-field leak
CreepJS/FingerprintJS-style detectors correlate against the rest of the
fingerprint to unmask a "too clean" browser. The compatibility-risk tradeoff
this section describes (some games/map-renderers/CAPTCHAs branch on the
reported GPU string) still exists and hasn't changed — what changed is the
judgment that a *silent* real-GPU leak on every profile is the worse default
of the two risks. Users who hit a real compatibility problem can still
switch a profile back to `'off'` from the same Fingerprint tab toggle; the
toggle itself, the warning banner, and the underlying override mechanism are
all unchanged by this default flip. The migration's own column-level SQL
default (`003_webgl_spoofing_mode.sql`: `DEFAULT 'off'`) is intentionally
left as-is — every insert always sets this field explicitly from the
generated fingerprint, so the SQL default only matters as a fallback for a
hand-written row and was never the actual mechanism determining what new
profiles got.

## Permissions and geolocation

Not implemented, and — more fundamentally — **not represented in the
fingerprint data model at all** (`src/shared/schemas/fingerprint.ts` has no
`permissions` or `geolocation` field). Real, legitimate mechanisms exist for
future work (`session.setPermissionRequestHandler` for permissions; CDP
`Emulation.setGeolocationOverride` for geolocation) but were not explored
further in this stage since there's no schema/UI to configure them yet —
adding the mechanism without the data model and validation around it would
be exactly the kind of half-implemented feature this project's rules forbid.

## Consistency engine improvements made this stage

`src/main/fingerprint/validator.ts` already checked OS↔platform, OS↔UA,
browserVersion↔UA, locale↔languages, timezone↔locale, and GPU↔OS coherence
(see `tests/unit/fingerprintGenerator.test.ts`). Added this stage
(`tests/unit/consistencyEngine.test.ts`):
- Explicit dedicated tests for the brief's own named "impossible combination"
  examples (Windows + macOS-only platform string; macOS + Windows-only UA).
- A new plausibility warning for implausible CPU/RAM pairings (e.g. 16+ cores
  with ≤2GB RAM, or ≥16GB RAM with ≤2 cores) — a warning, not an error, since
  such machines are unusual but not impossible.

## Browser/Chromium update compatibility check (new this stage)

`src/main/fingerprint/browserCompatibility.ts` compares a fingerprint's
configured browser version against `process.versions.chrome` — the Chromium
version actually bundled with the running Electron build — read live rather
than hardcoded, so it stays correct across Electron upgrades. Wired into
`ProfileManager.start()`: if a profile's fingerprint claims a different major
Chromium version than what's actually running, a `FINGERPRINT_CHANGED`
activity log entry is recorded (does not block startup). This directly
addresses a real risk this project already has: `platformProfiles.ts`
hardcodes `browserVersion: '128.0.0.0'`, and if Electron is upgraded to bundle
Chromium 132 without updating that constant, existing profiles would
silently claim a UA their engine no longer matches — now at least surfaced,
not silent.

## Profile fingerprint snapshot (§17, new this stage)

Whenever the diagnostics page runs (opened manually via the browser
toolbar's "Diagnostics" button, or automatically under the
`PF_E2E_AUTO_DIAGNOSTICS=1` test-only mode — see below), it hands its full
configured-vs-observed report to a narrow preload bridge
(`src/main/browser/diagnosticsPreload.ts`, gated to the `profileforge://`
origin only — see the file's own comment for why), which the main process
writes to `<profile directory>/fingerprint-snapshot.json`. Only technical
diagnostic values are stored (the same fields shown on the diagnostics page)
— never page content, cookies, or browsing history. This allows comparing a
profile's actual observed fingerprint before and after an app/Electron
upgrade.

## Testing-only mechanism: `PF_E2E_AUTO_DIAGNOSTICS`

Per the brief's own instruction ("if a JS override is used for testing,
clearly label it as a testing mechanism"): when this environment variable is
set to `'1'` on the manager process (and inherited by the spawned per-profile
child process), the started profile navigates straight to the diagnostics
page instead of the normal start page. **Never set in a normal launch** —
only `tests/e2e/fingerprintEnforcement.spec.ts` sets it, specifically so the
automated test can read the resulting snapshot file without needing to
control the nested Electron window's UI directly. This is a test-harness
convenience, not a fingerprint-spoofing mechanism — it changes only which
page loads, not any reported value.

## CDP footprint reduction + Worker/SharedWorker propagation fix (new this stage)

**Motivation.** A real CreepJS scan (https://abrahamjuliot.github.io/creepjs/,
run against a genuine, unmodified profile via `tests/e2e/creepjsBenchmark.spec.ts`
— see `docs/creepjs-results/` for the full, unedited, dated captures this
section is based on) surfaced two real, previously undocumented problems:

1. Every real profile's spoofing mechanism relied on
   `webContents.debugger.attach('1.3')` (a real Chrome DevTools Protocol
   session) for canvas/audio/WebGL/deviceMemory/fonts/mediaDevices injection
   (`Page.enable` + `Page.addScriptToEvaluateOnNewDocument`), on top of the
   `Emulation.*` calls already needed for UA/platform/hardwareConcurrency/
   screen. An attached CDP session with `Page`/`Runtime` domains enabled is
   exactly the kind of automation tell sophisticated fingerprint scripts
   (CreepJS explicitly among them) are built to detect.
2. **Web Workers and Service Workers received none of these overrides at
   all.** A live scan showed a profile configured as macOS reporting its
   *real* host identity — Windows, an NVIDIA RTX 4060, a real
   `profileforge/0.1.0 ... Electron/32.3.3` user agent, 16 real CPU cores —
   from inside a Worker context, while the main document correctly reported
   the configured macOS identity. Neither CDP's `Emulation.*` overrides nor
   the old `Page.addScriptToEvaluateOnNewDocument` injection reach a
   Worker's own separate global scope at all.

**What moved off CDP.** `src/main/browser/spoofingScript.ts`'s output
(canvas/audio/WebGL-vendor-spoofing/deviceMemory/fonts/mediaDevices, plus the
new Worker propagation below) is now injected via
`src/main/browser/diagnosticsPreload.ts` — a real `<webview preload>` script,
forced by `will-attach-webview` the same way the pre-existing diagnostics
bridge already was — using the classic "insert a same-document `<script>`
element with inline text content" technique instead of
`Page.addScriptToEvaluateOnNewDocument`. `fingerprintEnforcement.ts` no
longer calls `Page.enable` at all; `injectSpoofingScript()` was removed
entirely. `wc.debugger.attach()` is still used, but only for the three
`Emulation.*` calls below — a real, verifiable reduction in enabled CDP
domains, not a cosmetic one.

**What deliberately stayed on CDP, and why** (a conscious decision, recorded
here per that decision):
- `Emulation.setUserAgentOverride` (UA/platform/acceptLanguage on the main
  document) and `Emulation.setHardwareConcurrencyOverride` — `navigator.platform`
  has no non-CDP equivalent that also stays consistent with the real
  `Emulation.setUserAgentOverride`-driven UA at the network level.
- `Emulation.setDeviceMetricsOverride` (screen/devicePixelRatio) — this
  changes the actual Blink layout engine's `@media`/`matchMedia()`
  evaluation, not just the JS-readable `screen.width`/`height`. A JS-only
  override would leave `screen.width` and `matchMedia('(width: ...)')`
  disagreeing — exactly the class of mismatch CreepJS's own "CSS Media
  Queries" check exists to catch. Trading the CDP tell for a worse,
  guaranteed-detectable JS/CSS mismatch was judged the wrong trade.
- Session-level UA (`ses.setUserAgent()` in `profileWindowEntry.ts`, unchanged)
  already covers the real HTTP `User-Agent`/`Accept-Language` headers without
  CDP at all — this was already true before this stage and remains the
  authoritative mechanism for the network-level UA.

**Worker/SharedWorker propagation (new, real fix).** `buildSpoofingScript()`
now rewrites every `window.X` reference to `self.X` throughout (a normal
document's `self` is `window`; a Worker's `self` is its own global scope —
same script, portable to both without change) and adds:
- An unconditional per-property `navigator.userAgent`/`platform`/
  `hardwareConcurrency`/`deviceMemory` override, applied identically inside
  the main document (redundant with the CDP values there, harmless) and
  inside every Worker (the *only* mechanism providing these values there at
  all). Each property is wrapped in its own `try`/`catch` — a real bug found
  this stage: a single shared `try`/`catch` around all four meant one
  property throwing on `WorkerNavigator` (`platform`, on this Chromium
  build) silently aborted the other three, leaving `hardwareConcurrency`/
  `deviceMemory` unset even though `userAgent` alone had already succeeded.
- `window.Worker`/`window.SharedWorker` are wrapped so that
  `new Worker(scriptURL)` fetches the original script via a **synchronous**
  `XMLHttpRequest` (resolves instantly against `blob:`/`data:`/same-origin
  URLs — no real network wait), prepends the exact same patch script, and
  constructs the real worker from a combined `Blob` URL instead — so the
  patches run first, inside the worker's own global scope, before any of
  the worker's own code. **Verified directly** (not just via CreepJS) with a
  standalone dedicated-Worker diagnostic: a profile configured as
  `Linux x86_64 / 4 cores / 8GB` reported *exactly* that — UA, platform,
  hardwareConcurrency, and deviceMemory all correct — from inside a real
  `new Worker('/worker.js')` created by an ordinary same-origin page, both
  for a `blob:`-URL worker and a same-origin-file worker.

**Confirmed, real, honest limitation: Service Workers.** CreepJS's own
"Worker" test tries `navigator.serviceWorker.register()` *first*, only
falling back to `SharedWorker` then a dedicated `Worker` if registration
throws. A rerun of the live CreepJS scan after this stage's fix still shows
the real host identity leaking specifically through that path — confirmed,
not just predicted, by the unchanged CreepJS output alongside the
independently-verified working dedicated-Worker diagnostic above.

**Root cause — verified empirically this stage, not assumed.** A minimal,
isolated diagnostic (`await navigator.serviceWorker.register(blobUrl)`
against a real profile's webview) captures the exact Chromium error, thrown
synchronously as a rejected promise, not a permissions/CSP failure:
```
TypeError: Failed to register a ServiceWorker: The URL protocol of the
script ('blob:http://127.0.0.1:.../d84a9d21-...') is not supported.
```
The identical same-origin `http://` URL registered in the same test, same
webview, same session, succeeds without incident (`OK: http://127.0.0.1:.../`)
— ruling out this project's own `session`/CSP configuration as the cause.
This is the Service Worker spec's own restriction (the registering script's
URL must use an HTTP(S) scheme), enforced unconditionally by Chromium's own
registration algorithm — not a policy this project set, and not one it can
turn off via any `session`/`webContents` setting.

**Three real alternatives investigated this stage, all rejected — not for
lack of trying, but because each trades this one narrow gap for a worse or
uncertain problem:**

1. **Serve the patched script from this project's own `profileforge://`
   protocol instead of a `blob:` URL.** Rejected immediately: `profileforge`
   is a *custom* scheme, not `http`/`https` — Chromium's check above rejects
   it exactly the same way it rejects `blob:`.
2. **Session-level network interception** (`session.protocol.handle('http', …)`
   / `handle('https', …)`, rewriting just the Service Worker script's
   response body while passing every other request through unchanged).
   Technically the correct shape of fix for *this specific* restriction (the
   script's URL/origin/protocol never has to change, only its body) — but
   `protocol.handle()` intercepts *every* request for that scheme in the
   session, with no narrower "just this one URL" registration. A correct,
   safe passthrough for everything else would mean this project re-implementing
   streaming, redirects, POST bodies, cookies/credentials, and range requests
   (video, large downloads) for *all* real browsing in every profile, just to
   patch the rare site that fingerprints specifically via Service Worker.
   Distinguishing "this request is fetching a Service Worker script" from an
   ordinary script request also isn't available on the `protocol.handle()`
   `Request` object itself — it would need a second, separate
   `session.webRequest.onBeforeRequest` listener (where `resourceType`
   *is* exposed) just to flag which URLs to treat differently. The risk this
   adds to every profile's real browsing was judged clearly disproportionate
   to closing one narrow, already-documented gap.
3. **Electron's dedicated `session.serviceWorkers` API.** Checked directly
   against this project's installed Electron type definitions
   (`node_modules/electron/electron.d.ts`) rather than assumed from memory:
   it exposes `getAllRunning()`/`getFromVersionID()` and two events
   (`console-message`, `registration-completed`) — no method to run script
   inside a Service Worker's own global scope, and `registration-completed`
   fires only *after* registration has already resolved (i.e. after the
   worker has already started), too late for the "before the worker's own
   code runs" guarantee this project's other spoofing relies on. Not usable
   for this at all, in this Electron version.

A fourth option — CDP's `Target.setAutoAttach` at the *browser* level to
catch Service Worker targets as they spawn, then `Runtime.evaluate` into
them before resuming — is the closest real analogue to what already works
for the main document, but it would need a browser-wide debugger session
(Electron's `webContents.debugger` is scoped to one page's own WebContents,
not the whole browser), which is *more* CDP surface, not less — directly
counter to this stage's own "CDP footprint reduction" goal, for a narrow
benefit. Not attempted.

No clean fix exists within this project's current architecture. Left as a
documented, verified gap — with the exact failure captured, the alternatives
considered, and the reasoning for not pursuing each recorded here — rather
than silently claimed as covered or force-fixed at the cost of core
browsing reliability.

**Later stage — discovered a wider blast radius than originally scoped, and
a real gap between what the internal E2E test proves and what an external
detector actually sees.** The WebGL section of `fingerprintEnforcement.spec.ts`
(the `webglSpoofingMode "spoof" actually overrides the observed
vendor/renderer` test) passes, and correctly so — it proves the
`getParameter()` override mechanism itself works once installed, verified
directly against the diagnostics page's own WebGL context. What it does
**not** prove, and what nothing in this project's test suite checked until
this stage, is that the override actually gets *installed* in every context
a real external site might read a WebGL fingerprint from. It does not: a
live CreepJS run (with `webglSpoofingMode: 'spoof'` configured and the
diagnostics test above green) still reports this machine's **real** GPU in
CreepJS's own `WebGL` section — a full profile-vs-real mismatch, not a
partial one — across every capture in `docs/creepjs-results/` taken after
the WebGL-default-on stage.

Root-caused via direct instrumentation, not inferred: temporarily added a
`fetch()` beacon to a local diagnostic HTTP server inside both the
`navigator.serviceWorker.register` wrapper's success/fallback branches and
`patchWebGL()`'s `patch()`/`getParameter` calls (reverted immediately after
capturing the evidence — never shipped; the captured log is preserved at
`docs/investigation-logs/2026-09-01-webgl-serviceworker-instrumentation.log`),
then ran the real `creepjsBenchmark.spec.ts` against the instrumented build.
The log shows `patchWebGL-ran` and `getParameter-called` firing *only* with
`scope=MainDocument` — never once in a worker scope — and, at the exact
moment CreepJS's own report would have been populated, two `fallback-real`
entries with this literal captured error:
```
TypeError: Failed to register a ServiceWorker: The URL protocol of the
script ('blob:https://abrahamjuliot.github.io/044bba02-23b0-41db-9b13-37e0c12a56e3')
is not supported.
```
This is the *identical* restriction already documented above, just
triggered by a different caller: CreepJS's own worker-scope probe registers
its Service Worker against a real, same-origin `./creep.js` URL (confirmed
by reading CreepJS's own source at `creep.js` — `getServiceWorker()` calls
`navigator.serviceWorker.register('./creep.js')` directly, never a `blob:`
URL of its own), which this project's wrapper intercepts, tries to
re-register as a `blob:` URL carrying the spoofing prefix, gets rejected by
the same Chromium restriction, and correctly falls back to registering
CreepJS's real, *completely unpatched* script — inside which CreepJS then
also creates an `OffscreenCanvas` and reads its WebGL vendor/renderer
(`getWebglData()`, called from `getWorkerData()`, both defined and executed
entirely within the worker-scope code CreepJS ships as part of the very
script that just got registered unpatched). The WebGL leak was never a bug
in the `getParameter()` override logic itself — that logic is correct and
does apply, confirmed by the same log, whenever it actually runs on the main
document — it's a **downstream consequence of the exact same Service Worker
gap** already documented above, just reaching a second, previously-unnoticed
report section (`WebGL`) in addition to the already-known one (`Worker`).

Whether patching `WebGLRenderingContext.prototype`/`WebGL2RenderingContext.prototype`
inside a Service/Shared/Dedicated Worker's own global is *technically*
possible was already answered by this same section above for the
navigator-field case: dedicated/shared Worker propagation already works
(the `wrapWorkerCtor` mechanism installs this exact same core script,
WebGL patch included, inside every dedicated/shared Worker verified
directly earlier this stage) — the wrapper already generalizes to WebGL
with no extra work needed there. The one path that doesn't and structurally
can't, without the same disproportionate architecture change already
rejected (three alternatives evaluated and declined above), is Service
Worker specifically. No new fix avenue was found by re-examining this from
the WebGL angle — the conclusion is the same, now confirmed to cover more
ground than previously known.

**The methodological gap this exposes, and why it matters going forward:**
`fingerprintEnforcement.spec.ts` only ever drives the diagnostics page
directly — it never registers a real Service Worker, dedicated Worker, or
`OffscreenCanvas` against any test fixture, so a reader seeing that suite
fully green had no signal that a real external site's Service-Worker-based
probe would see something different. A "verified" grade in the reality
matrix above means *the override mechanism works when installed*, not *this
mechanism reaches every code path an external site might use to ask* — for
any field whose only enforcement is a JS-level override rather than a
CDP domain applied at the process/session level, these are genuinely
different claims, and this stage is the first time the difference produced
a real, previously-uncaught leak. `creepjsBenchmark.spec.ts` remains the
project's only test that would ever have caught this in the first
place — deliberately unasserted (see its own module comment: no fixed
"correct" score to assert against) — which is why this stage adds a new,
narrow, real-Service-Worker-registration case directly to
`fingerprintEnforcement.spec.ts` itself (see below), so this specific class
of gap shows up as a **failing** internal test the next time it regresses,
not just as an unasserted external capture someone has to notice by eye.

**CreepJS raw numbers, before and after (see `docs/creepjs-results/` for the
full unedited captures).** The `44% like headless` figure was unchanged
across all three runs (before the fix, after the Worker per-property
try/catch fix alone, and after the full preload migration) — consistent
with it reflecting the still-present `Emulation.*` CDP domain (kept per the
decision above), which this stage never touched. The Worker section's
`userAgent`/`device`/`gpu` fields changed from the real host machine (before
this stage) to the real host machine *still* (after — confirmed the
ServiceWorker-specific gap above) for the exact same reason each time; a
separate, non-CreepJS diagnostic is what actually proves the dedicated-Worker
path itself is fixed, since CreepJS's own fallback ordering means it never
reaches that path on a machine where SW registration "succeeds" (even with
unpatched content).

## Automated test coverage

- `tests/e2e/fingerprintEnforcement.spec.ts` (3 tests) — starts a real
  profile, asserts the enforced fields (userAgent, platform, languages,
  timezone, screenWidth, screenHeight, hardwareConcurrency, **deviceMemory**,
  **canvasMode**, **audioMode**) are `PASS`/`APPLIED` in the real
  browser-generated snapshot, with an explicit assertion that canvas noise
  is deterministic (`observed.canvasDeterministic === true`); asserts the
  fields that remain off by default (webglVendor, webglRenderer, fontsMode,
  mediaDevicesMode) are honestly `NOT_IMPLEMENTED` — guarding against a
  regression that silently starts claiming false coverage; and a third test
  starts a **second** profile and asserts its canvas noise tail differs from
  the first profile's despite drawing identical content, proving the noise is
  genuinely per-profile-seeded rather than a single fixed patch.
- `tests/unit/spoofingScript.test.ts` (11 tests) — `buildFakeMediaDevices()`
  determinism (same seed → identical list) and cross-seed variation;
  `buildSpoofingScript()` emits each conditional patch (canvas/audio/webgl/
  fonts/media-devices) only when its mode flag calls for it, emits the
  unconditional deviceMemory override always, and produces syntactically
  valid JS (`new Function(script)` smoke test).
- `tests/unit/consistencyEngine.test.ts` (5 tests) — impossible-combination
  rejection + hardware plausibility warnings.
- `tests/unit/browserCompatibility.test.ts` (3 tests) — the new Chromium
  version drift check.

## Acceptance checklist — spoofing-gaps stage

- [x] Existing 98 tests still pass, plus 11 new (`spoofingScript.test.ts`) =
      109 unit/integration; fingerprint E2E suite now 3 tests, all passing
- [x] Canvas noise implemented: seeded, deterministic per-profile (E2E-verified
      via double-read equality **and** cross-profile difference on identical
      content), on by default (`canvasMode: 'noise'`, unchanged generator default)
- [x] Audio noise implemented: same seeding pattern, override presence
      verified via `isOverridden()`, on by default
- [x] Device Memory implemented: unconditional override, E2E-verified equal
      to the configured value (upgraded from D to A)
- [x] WebGL vendor/renderer spoofing implemented **behind a new, off-by-default
      opt-in toggle** (`webglSpoofingMode`) with an explicit compatibility-risk
      warning in the UI, per the explicit instruction to do so for anything
      "technically difficult or risky to implement reliably" — see §WebGL
      spoofing above for the full tradeoff writeup
- [x] Fonts restriction implemented behind its existing `fontsMode` toggle
      (default remains `'system'`/off); partial-coverage limitation (CSS
      fallback-measurement technique not blocked) documented in both the audit
      and the Fingerprint tab's own UI hint text
- [x] Media devices masking implemented behind its existing `mediaDevicesMode`
      toggle (default remains `'real'`/off); seeded synthetic device list,
      structurally verified as non-real by the diagnostics page
- [x] Every new field's UI control lives in ProfileEditorModal's Fingerprint
      tab, auto-saves on change via `fingerprint:update`, consistent with the
      rest of the tab's existing fields
- [x] All new i18n strings added in lockstep to `en.ts`/`uk.ts` — key parity
      re-verified (195/195, 0 missing, 0 extra)
- [x] Diagnostic page extended: `isOverridden()`, `canvasIsDeterministic()`,
      `mediaDevicesLookFake()` give genuine behavioral verification instead of
      trusting the configured mode flag — never a false PASS/APPLIED
- [x] No fake implementations exist (every override runs via the same native
      CDP `Page.addScriptToEvaluateOnNewDocument` injection mechanism, verified
      end-to-end against a real Electron/Chromium process, not simulated)
- [x] Documentation updated (this file)
- [x] Typecheck, lint, full unit suite, and the fingerprint E2E suite all pass
- [x] Production build succeeds

**Update, later stage:** `webglSpoofingMode`'s default was changed from
`'off'` to `'spoof'` for newly generated profiles (see §WebGL spoofing
above) — the toggle, warning banner, and off-by-request opt-out described in
this checklist are all still exactly as built here; only which state a new
profile starts in changed.
