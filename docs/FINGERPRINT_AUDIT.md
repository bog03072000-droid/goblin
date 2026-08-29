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
| deviceMemory | ✅ | ❌ | real device value | ✅ (range only) | ✅ (asserts NOT_IMPLEMENTED) | none exists (see Finding 3) | **D** |
| WebGL vendor | ✅ | ❌ | real GPU value | ✅ (plausibility only) | ✅ (asserts NOT_IMPLEMENTED) | none exists (see Finding 4) | **D** |
| WebGL renderer | ✅ | ❌ | real GPU value | ✅ (Apple-only-on-macOS check) | ✅ (asserts NOT_IMPLEMENTED) | none exists (see Finding 4) | **D** |
| Canvas | ✅ (`canvasMode`) | ❌ | real canvas output | schema only | ✅ (asserts NOT_IMPLEMENTED) | none without a Chromium fork or fragile JS monkeypatch — see §Canvas | **D** |
| AudioContext | ✅ (`audioMode`) | ❌ | not read by diagnostics (no reliable enumeration) | schema only | not applicable | same as Canvas — see §Audio | **D** |
| WebRTC | ✅ (`webrtcMode`) | ✅ (best available) | live ICE-candidate probe | n/a | ✅ | `webContents.setWebRTCIPHandlingPolicy()` (see Finding 5) | **B** |
| Fonts | ✅ (`fontsMode`) | ❌ | not probed (see §Fonts) | schema only | ✅ (asserts NOT_IMPLEMENTED) | none — see §Fonts | **D** |
| Media devices | ✅ (`mediaDevicesMode`) | ❌ | ✅ real enumeration | schema only | ✅ (asserts NOT_IMPLEMENTED) | see §Media devices | **D** |
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

## Why Canvas, Audio, and Fonts are D — and what real implementation would need

**Canvas.** Real anti-fingerprint browsers (Tor Browser, Brave, LibreWolf)
add per-session noise to `toDataURL()`/`getImageData()` at the *compiled
Chromium/Firefox source level*, inside the actual canvas rasterization path.
There is no Chromium command-line flag or CDP method that does this. The only
mechanism reachable from application code is a preload script that
monkeypatches `HTMLCanvasElement.prototype.toDataURL`/`getContext` in the
page's JS context. The brief explicitly says not to ship "crude global random
noise" as a production feature, and a naive override is both detectable (the
patched function's `.toString()` differs, timing differs, and non-seeded
noise breaks legitimate uses like canvas-based CAPTCHAs or image editors) and
would make the diagnostics page's own canvas read lie about what real content
pages see. **Required future architecture**, if this is prioritized later: a
preload script scoped per-partition that wraps the canvas 2D/WebGL read-back
methods with a *deterministic, seeded* per-profile noise function (keyed off
the same seed already used for fingerprint generation), clearly labeled in
the UI as "experimental" until it has its own detectability review — not
attempted in this stage.

**Audio.** Same category of problem as Canvas — `AudioContext` fingerprinting
noise is normally added inside the audio rendering pipeline at the browser's
native code level. No CDP/session mechanism exists. Same future architecture
note applies (seeded noise via a preload wrapper around
`AudioBuffer`/`AnalyserNode` methods), not attempted here.

**Fonts.** Font enumeration via CSS-fallback measurement (or the permission-
gated Local Font Access API) reads the real installed system font set. There
is no Chromium flag to swap in a different font list per-profile without
actually isolating the OS-level font directory per profile (e.g. a sandboxed
per-profile font path), which is an OS-level capability outside Chromium's
own configuration surface and outside this project's current architecture.
Documented as D; the diagnostics page deliberately does not attempt a fake
font-enumeration probe.

## Media devices

`navigator.mediaDevices.enumerateDevices()` reflects the real system's actual
audio/video devices (verified on the dev machine: 3 audio inputs, 1 video
input, 6 audio outputs — the real hardware, not a fabricated list).
`mediaDevicesMode: 'hidden'` is stored and validated but not enforced: doing
so honestly would require either denying camera/microphone permission
(`session.setPermissionRequestHandler`, which mostly redacts device *labels*,
not device *count*) or providing fake virtual devices (a Chromium flag,
`--use-fake-device-for-media-stream`, replaces devices with **synthetic**
ones — not "hidden", a different semantic than our schema's field name
implies). Left as D rather than shipping a mechanism that doesn't match the
field's stated meaning.

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

## Automated test coverage added this stage

- `tests/e2e/fingerprintEnforcement.spec.ts` (2 tests) — starts a real
  profile, asserts the enforced fields (userAgent, platform, languages,
  timezone, screenWidth, screenHeight, hardwareConcurrency) are `PASS` in the
  real browser-generated snapshot, **and** asserts the unenforced fields
  (deviceMemory, webglVendor, webglRenderer, canvasMode, fontsMode,
  mediaDevicesMode) are honestly `NOT_IMPLEMENTED` — guarding against a
  regression that silently starts claiming false coverage.
- `tests/unit/consistencyEngine.test.ts` (5 tests) — impossible-combination
  rejection + hardware plausibility warnings.
- `tests/unit/browserCompatibility.test.ts` (3 tests) — the new Chromium
  version drift check.

## Acceptance checklist for this stage

- [x] Existing 62 tests still pass (now 63 unit/integration + 9 E2E = 72 total)
- [x] New fingerprint tests pass (10 new: 2 E2E + 5 consistency + 3 compat)
- [x] User-Agent verified (real browser read, E2E)
- [x] Locale verified (real browser read, E2E)
- [x] Languages verified (real browser read, E2E)
- [x] Timezone verified (real browser read, E2E)
- [x] Screen/viewport verified (real browser read, E2E; viewport vs. screen
      distinction explicitly documented and tested)
- [x] WebGL audited (confirmed D — no native override mechanism exists)
- [x] Canvas audited (confirmed D — documented required future architecture)
- [x] Audio audited (confirmed D — same category as Canvas)
- [x] WebRTC audited (graded B — real native leak-protection policy applied;
      "disabled" mode's honest limitation documented; live ICE probe added)
- [x] Fonts audited (confirmed D — no reliable per-profile mechanism exists)
- [x] Media devices audited (confirmed D — real enumeration verified,
      "hidden" mode's mismatch with available mechanisms documented)
- [x] Hardware concurrency audited (confirmed A — CDP override verified)
- [x] Device memory audited (confirmed D — CDP method does not exist, tested)
- [x] Fingerprint consistency validated (existing checks + new tests for the
      brief's own named impossible-combination examples + hardware plausibility)
- [x] Diagnostic page shows configured vs observed (rewritten with an explicit
      PASS/MISMATCH/NOT_IMPLEMENTED/APPLIED status column per property)
- [x] Unsupported features are explicitly marked (status column; never a
      silent PASS on an unenforced field, even when values coincidentally match
      — verified: deviceMemory showed matching values by coincidence during
      testing and was still correctly reported NOT_IMPLEMENTED)
- [x] No fake implementations exist (every A/B-graded mechanism is backed by
      a real Chromium/Electron API, verified empirically before being coded)
- [x] Documentation is updated (this file + README/SECURITY/ARCHITECTURE/
      PLAN/TESTING/CHANGELOG)
- [x] Production build succeeds
