# Fingerprint Reality Audit

> **Status: real gap, closed by default since this stage
> (`serviceWorkerMode: 'disabled'` for every new profile).** Spoofing
> (navigator fields, canvas/audio noise, WebGL vendor/renderer) is
> genuinely applied and E2E-verified for the main document and every
> dedicated/shared Worker. Before this stage, it did **not** reach a
> Service Worker's own global scope, nor a same-page `<iframe>`'s own
> WebGL context — two real, reproducible gaps that together let a
> Service-Worker-based fingerprint probe (this is exactly how CreepJS reads
> part of its report) see this machine's real GPU and real navigator
> values instead of the configured ones. Seven independent attempts were
> made before this closed cleanly: the first three broke a real
> proxy-authentication regression (core functionality); the fourth and
> fifth each fixed the Service Worker side alone but both introduced the
> exact same new, reproducible CreepJS "stealth" detection signal (a
> cross-context GPU mismatch, `hasBadWebGL` — confirmed by reading
> CreepJS's actual source in the sixth stage, not guessed); the seventh
> closed the *other* side of that exact mismatch (a hidden iframe CreepJS
> injects into the page, never previously reached by this project's
> spoofing injection) and, only in combination with the fifth attempt's
> Service Worker deletion, brought CreepJS's "stealth" score back to the
> exact same hash as a clean, untouched baseline — verified twice, with
> real captures. Shipped first as an opt-in toggle, then — once verified
> clean against proxy-auth, real-site browsing (8 real sites, including a
> broader pass with a completely default profile), and performance —
> flipped to the default for every new profile, the same reversal
> `webglSpoofingMode` went through earlier: a silent leak on every profile
> was judged the worse of the two real risks. Existing profiles created
> before this stage keep whatever they had. One known, unresolved
> reliability gap remains: the deletion patch doesn't reliably apply on
> every real site — confirmed on both `github.com` and, newly, `x.com`
> (`twitter.com`), both sites that redirect at the top level during load,
> suggesting a real pattern rather than a single site's quirk; not yet
> root-caused or fixed. See **"Confirmed, real, honest limitation: Service
> Workers"**, **"Third and final attempt"**, **"Fourth attempt — browser-
> level Target.setAutoAttach"**, **"Fifth attempt — remove Service Worker
> entirely"**, **"Sixth investigation — root-causing the stealth regression
> precisely"**, **"Seventh attempt — patch WebGL inside the iframe too"**,
> and **"Default flip"** below for the full technical history if you need
> it — most readers won't.

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

## Explicit field selection (new this stage)

Fingerprint generation was always seed-based autogeneration picking one
coherent "platform bundle" (OS + OS version + platform string + screen +
CPU + RAM + GPU) as a unit from `PLATFORM_PROFILES`
(`src/main/fingerprint/platformProfiles.ts`) — never mixing independently
randomized fields, which is what keeps a generated fingerprint internally
consistent. This stage adds an explicit, convenient UI for choosing
individual fields within that same coherent-bundle constraint, instead of
only trusting the random seed:

- **OS**, **OS version**, **browser (Chrome) version**, **CPU core count**
  (`hardwareConcurrency`), **RAM** (`deviceMemory`), **GPU vendor/renderer**,
  and **screen resolution** are each selectable from a real, concrete list —
  in `ProfileCreateModal.tsx` and `ProfileEditorModal.tsx`'s Fingerprint tab,
  via the new `FieldOverridesPicker` in
  `src/renderer/components/profileEditor/FingerprintTab.tsx`.
- Every field defaults to **Auto** (the existing seed-based random pick);
  switching to a concrete value overrides only that field.
- Changing OS clears the OS-version and GPU overrides, since those belong to
  the previous OS's option list — this is a UI convenience, not the actual
  safety mechanism.
- The actual coherence guarantee lives server-side in
  `generateFingerprint()` (`src/main/fingerprint/generator.ts`): every
  override is checked against the *resolved* platform's own real option
  list (`platform.osVersions`, `platform.screens`,
  `platform.hardwareConcurrencyOptions`, `platform.deviceMemoryOptions`,
  `platform.gpuOptions`) before being applied. An override that doesn't
  belong to the resolved OS — e.g. a stale UI selection from before an OS
  switch, or any attempt to request an Apple GPU on a Windows profile — is
  silently ignored and falls back to a random pick from that OS's own
  options, rather than producing an incoherent fingerprint or throwing.
  `browserVersion` is the one exception: it isn't tied to the OS bundle in
  `PLATFORM_PROFILES` (the same Chrome versions are offered across every
  OS), so any of `BROWSER_VERSIONS` is accepted for any OS.
- New IPC channel `fingerprint:options` returns the real per-OS option
  lists (`FingerprintOptionsResponse`, `src/shared/schemas/fingerprint.ts`)
  so the UI never hardcodes a list that could drift from
  `PLATFORM_PROFILES`. `fingerprint:generate` accepts the same override
  fields as optional parameters.
- Covered by `tests/unit/fingerprintGenerator.test.ts` (valid overrides
  applied, foreign/invalid overrides ignored per field, and a
  multi-field-override combination still passes `validateFingerprint()`).
- This is a UI/ergonomics addition on top of the existing classification
  below — it does not change which fields are actually enforced in the
  real browser process (that's determined by the Reality matrix and
  Findings sections that follow, unchanged by this feature).

## Automation API and CDP detectability (new this stage)

The new opt-in per-profile automation feature (`src/main/browser/automationProxy.ts`,
Advanced tab) puts a token-gated proxy in front of Chromium's own
`--remote-debugging-port`, off by default. Two points worth being explicit
about rather than leaving implicit:

- **This does not change a profile's fingerprint when automation is off**
  (the default for every profile unless a user explicitly enables it) —
  `--remote-debugging-port` is never set for a profile that hasn't turned
  this on, same as before this feature existed.
- **When a user does enable it and drives the browser over CDP through it**,
  that session is now genuinely CDP-automated — the same real, well-known
  detection surface any Puppeteer/Playwright/Selenium-driven Chromium
  session already has (e.g. `Runtime.enable`'s own observable side effects,
  which is how several public anti-bot detectors flag CDP automation
  regardless of which tool sits on top of it). This isn't a gap this
  feature introduces or could plausibly close — it's an inherent property
  of driving a real browser over CDP at all, orthogonal to everything else
  in this document about navigator/canvas/WebGL spoofing. A user turning
  this on for a given profile is trading that detectability for genuine
  programmatic control, and should know that's the trade, not be told it's
  free.

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
| WebGL (vendor/renderer) | Yes | **On by default since this audit stage** (`webglSpoofingMode: 'spoof'`), still a per-profile opt-out toggle | Yes on the main document/dedicated/shared Worker — **confirmed NOT reached inside a Service Worker** (see §Service Workers' addenda: a real CreepJS run leaks the true GPU through this exact path despite spoofing being on; a later-stage attempt at closing it via network-level `protocol.handle()` injection worked technically but was reverted after it broke authenticated proxy browsing — see that addendum) | Off (opted out): honestly reports the real GPU/ANGLE string (asserted `NOT_IMPLEMENTED`, never a coincidental false PASS). On (default): `getParameter()` override on both `WebGL(2)RenderingContext.prototype`, intercepting only `UNMASKED_VENDOR_WEBGL`/`UNMASKED_RENDERER_WEBGL` — verified this stage to (a) actually apply the configured strings and (b) leave an unrelated real capability (`MAX_TEXTURE_SIZE`) unaffected, i.e. WebGL keeps working normally for real content, and (c) does **not** apply inside a Service Worker, root-caused and documented below rather than left as a silent gap. |
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
| WebGL vendor | ✅ | on by default (`webglSpoofingMode`, default `spoof` since this stage), per-profile opt-out | real GPU value if opted out **or if read from inside a real Service Worker** (see §Service Workers' addenda — confirmed leak path; a later attempt to close it via `protocol.handle()` network injection worked but was reverted after breaking authenticated proxy browsing) | ✅ (plausibility only) | ✅ **both states on the main document** (off: asserts NOT_IMPLEMENTED; on/default: asserts PASS with a matching value, plus a real WebGL capability read to confirm compatibility); ✅ **Service Worker case** (asserts the real, unpatched value — an honest NOT_IMPLEMENTED-style expectation, not a false PASS) | `getParameter()` override on `WebGL(2)RenderingContext.prototype`, same injection mechanism — on by default, see §WebGL spoofing; reaches dedicated/shared Workers via the same propagation as navigator fields, does **not** reach Service Workers, see §Service Workers | **B** on the main document/dedicated/shared Worker by default (→ **C** if opted out); **D** (not implemented, confirmed by both the original investigation and a reverted fix attempt) specifically for the Service Worker path |
| WebGL renderer | ✅ | on by default (`webglSpoofingMode`, default `spoof` since this stage), per-profile opt-out | real GPU value if opted out **or if read from inside a real Service Worker** (same confirmed leak path as WebGL vendor) | ✅ (Apple-only-on-macOS check) | ✅ **both states on the main document** (same test as vendor); ✅ **Service Worker case** | same as WebGL vendor | same grading as WebGL vendor |
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

**Later stage still — alternative #2 re-investigated as explicit R&D,
proven technically capable of closing the gap, then reverted after finding
a real, reproducible regression in core proxy functionality.** This was
approached on the explicit understanding it was research, not a guaranteed
fix, with instructions not to trade the app's stability for this one gap.
That is exactly what happened, in the end — recorded here in full because
the negative result (and *why* it's negative) is exactly as valuable as a
positive one would have been.

**What actually got built, and it did work:**

1. **Detecting "this is a Service Worker script fetch" turned out not to
   need `session.webRequest.onBeforeRequest`'s `resourceType` after all.**
   `Request.destination` (the spec-correct Fetch API signal, which *should*
   read `'serviceworker'`) was tried first and confirmed, empirically, to
   **not** be reliably populated by Electron's `protocol.handle()` — a
   temporary diagnostic logging every intercepted request's `destination`
   against a real `navigator.serviceWorker.register()` call came back with
   `destination` **empty on every single request**, SW script included.
   Instead: the page's own JS already knows the exact URL it's about to
   register — `spoofingScript.ts`'s existing `register()` wrapper computes
   it right before its (always-failing) blob: attempt falls back to the
   real one. That fallback was made to call a small `contextBridge`-exposed
   function telling the main process the exact absolute URL about to be
   registered, which kept a one-shot allowlist and only patched a request
   if its URL was in it.
2. **The network-level pass-through worked correctly for everything it was
   tested against.** Electron's `Session.fetch(request, {
   bypassCustomProtocolHandlers: true })` routed non-matching requests
   through the session's real Chromium network stack — `downloads.spec.ts`,
   `profileBrowserLifecycle.spec.ts` (including the persistent cookie/
   localStorage/IndexedDB-across-restart test), `fullUserFlow.spec.ts`, and
   `reliability.spec.ts`'s dead-proxy-still-starts-cleanly case all passed
   unchanged.
3. **The injection itself worked, confirmed live against real CreepJS, not
   just the internal test.** `fingerprintEnforcement.spec.ts`'s real-Service-
   Worker test passed with the spoofed value actually observed inside a real
   Service Worker, and a real CreepJS capture confirmed it independently:
   `Worker` section reporting `ServiceWorkerGlobalScope` (registration
   genuinely succeeded) with the **spoofed** GPU instead of the real host
   GPU, in both the `Worker` and separate `WebGL` report sections.

**The regression that stopped it: `protocol.handle('https', …)` broke
authenticated proxy browsing, reproducibly, 100% of the time.**
`proxyVerification.spec.ts`'s "a proxy with a username/password actually
authenticates" test — previously reliable — failed on every attempt (2/2 in
the full suite, 2/2 again in isolation) once the interceptor was active, and
passed again immediately (1/1) the moment it was disabled, with no other
change — a clean, deliberate A/B confirming direct causation, not
correlation. Root cause: per the Fetch specification, a request issued
through a `fetch()`-family API (`Session.fetch()` included) is not permitted
to trigger an interactive HTTP/proxy authentication prompt the way a real
top-level navigation is — that's a deliberate browser security boundary
(unrestricted programmatic credential prompting would be a phishing vector),
not an Electron bug or something this project's code got wrong. Once
`protocol.handle()` is registered for `https`, *every* request for that
session — real navigations included — gets rerouted through exactly that
kind of fetch-style call, so every request loses the ability to complete a
407 challenge, not just the injected ones. This is a spec-level ceiling on
the whole approach, not a narrow implementation bug with a plausible patch.

**Decision: reverted, not shipped.** Authenticated proxy support is core
functionality for an antidetect browser — trading it away to close one
fingerprint gap, however real that gap is, fails the explicit instruction
this stage was given. `serviceWorkerScriptInjection.ts` was deleted;
`profileWindowEntry.ts`, `spoofingScript.ts`, and `diagnosticsPreload.ts`
were reverted to their pre-this-stage state; `fingerprintEnforcement.spec.ts`
was reverted to its original honest-gap assertion (the leak is real again in
shipped code, exactly as documented above). The Service Worker gap remains
open, exactly as characterized in the rest of this section.

**Alternatives #1 and #3 above remain correctly rejected** (custom-scheme
serving still hits the same Chromium blob:-adjacent restriction; the
`session.serviceWorkers` API still has no script-injection capability).
**Alternative #2 is now also correctly rejected**, but for a different,
newly-discovered reason than originally guessed (the original writeup
worried about reimplementing streaming/redirects/cookies by hand, which
`Session.fetch()` actually handles fine — the real, fatal problem is the
interactive-auth restriction, which no amount of careful scoping avoids,
since it applies to the request mechanism itself, not to what the handler
does with it).

**Third and final attempt — confirmed the restriction is unconditional, not
avoidable by scoping.** The obvious next question after the paragraph above
is "what if only non-navigation requests go through the handler's actual
logic, and navigation requests are left alone?" — tried directly: the
interceptor was changed to check `request.mode === 'navigate'` first and,
for exactly those requests, do nothing but the same unmodified
`ses.fetch(request, { bypassCustomProtocolHandlers: true })` pass-through
every request already got in the first attempt (a Service Worker script
fetch is never itself a navigation, so this doesn't weaken the injection —
it only changes what happens to requests that were never the target
anyway). Result: **identical failure**, `proxyVerification.spec.ts`'s
authenticated-proxy test failed 2/2 attempts with the narrowed interceptor
active, confirmed passing again 4/4 the instant it was reverted. This
proves the earlier hypothesis rather than just restating it: the moment
`session.protocol.handle('https', …)` is registered on a session at all,
*every* request for that scheme — including navigations — must be answered
by constructing a `Response` inside the handler, and there is no
`Response`-construction path (an unmodified `Session.fetch()` pass-through
included) that preserves a real navigation's ability to complete an
interactive 407 challenge. The restriction lives in *how the response gets
back to Chromium*, not in what the handler computes — so no scoping rule
inside the handler can dodge it. Reverted again (`serviceWorkerScriptInjection.ts`
deleted, the same three files restored, confirmed via a clean
`proxyVerification.spec.ts` run afterward), and this is now closed as an
exhaustively investigated dead end: three concrete attempts (full
interception, narrowed-by-destination — abandoned early once `destination`
proved unpopulated — and narrowed-by-navigation-mode), one confirmed
working injection mechanism, one confirmed unconditional blocker, no
remaining unscoped variation of `protocol.handle()` left to try. No fix
currently known via `protocol.handle()` that doesn't either reintroduce
this regression or add disproportionate new surface. The fourth
alternative — CDP `Target.setAutoAttach` at the browser level — was
attempted next, in a later stage; see immediately below.

## Fourth attempt — browser-level `Target.setAutoAttach`, real partial fix, real new detection signal, reverted

**What this attempted.** The one alternative the "CDP footprint reduction"
stage above explicitly flagged as unattempted, for the reason stated there:
Electron's `webContents.debugger` is scoped to one page's own WebContents,
never the whole browser, so reaching a Service Worker target before it runs
its own code would need a genuinely different kind of CDP session — one
attached to the *browser* endpoint, not a page. Attempted directly this
stage: a real WebSocket CDP client (no client library existed in this
project's dependencies; a minimal one was written for exactly this,
`swAutoAttachExperiment.ts`, using the `ws` package — Electron's main-process
Node runtime was checked directly and confirmed to have no global
`WebSocket`, unlike a page's own JS context) connects to the browser-level
`webSocketDebuggerUrl` from `/json/version` on the profile's own
`--remote-debugging-port`, sends `Target.setAutoAttach({ autoAttach: true,
waitForDebuggerOnStart: true, flatten: true, filter: [...] })`, and on every
`Target.attachedToTarget` event for a `service_worker`-type target, runs
`Runtime.enable` + `Runtime.evaluate` with the exact same `self`-scoped core
patch script already used for dedicated/shared Worker propagation
(`buildCoreScript()`, newly exported from `spoofingScript.ts` for this),
then `Runtime.runIfWaitingForDebugger` to let the paused target actually
start — by which point the patch has already run.

Gated behind a new testing-only env var,
`PF_E2E_SW_AUTOATTACH_EXPERIMENT=1`, following the exact same convention as
`PF_E2E_AUTO_DIAGNOSTICS`/`PF_E2E_REMOTE_DEBUG_PORT` — never set in a normal
launch, and structurally *can't* be: this mechanism only works at all when a
real `--remote-debugging-port` is already open for the profile's entire
lifetime, which today only happens for automation-enabled profiles or E2E
test runs — never a normal profile. That is itself a real, structural cost
of this whole approach, independent of whether the mechanism works: shipping
this as the real fix would mean either opening a real, permanent, localhost
TCP CDP port on *every* profile process all the time (a materially larger
and more permanent surface than today's opt-in-only automation port), or
accepting the fix only protects automation-enabled profiles — not evaluated
further since the result below didn't clear the bar to justify picking
between those two costs at all.

**Method — same standard as the first three attempts: real captures, not
inference.** Two profiles were created per run (one baseline, one with the
experiment flag), both against a real CreepJS scan
(`https://abrahamjuliot.github.io/creepjs/`), using the project's own
existing profile-creation flow — no fixture, no mocked browser. Both
baseline and experiment runs used an already-open `--remote-debugging-port`
(`PF_E2E_REMOTE_DEBUG_PORT`, the same mechanism `creepjsBenchmark.spec.ts`
and every existing capture in `docs/creepjs-results/` already uses to drive
the tab bar via Playwright) so the comparison isolates exactly one variable
— the browser-level `Target.setAutoAttach` subscription and its per-target
patching — not "debug port open vs. not." Each scenario was run **twice**,
independently, to confirm every finding below reproduces rather than being
one-off noise; the exact reproduced numbers are given, not rounded or
averaged away.

**Result 1 — the Worker-section leak this stage specifically targeted is
genuinely, reproducibly fixed.** CreepJS's own "Worker" report section
(populated from inside the same Service Worker `getWorkerData()` reads
navigator/UA/GPU from) reported the real host identity in both baseline
runs and the **configured** identity in both experiment runs:

| Field | Baseline run 1 | Baseline run 2 | Experiment run 1 | Experiment run 2 |
|---|---|---|---|---|
| Worker `gpu` | real: `Google Inc. (NVIDIA)` / RTX 4060 | real: `Google Inc. (NVIDIA)` / RTX 4060 | configured: `Google Inc. (Apple)` / Apple M2 | configured: `Google Inc. (Apple)` / Apple M1 Pro |
| Worker `userAgent` | real `profileforge/0.2.0 ... Electron/32.3.3` UA | (same pattern) | configured UA, exactly | configured UA, exactly |
| Worker `cores`/`ram` | real: 16 cores | real: 16 cores | configured: 8 cores | configured: 8 cores |

This is a real fix of the exact, specific gap every prior stage of this
audit documented as open: the Service Worker registration this time
succeeded *through* the patched path (the paused-target injection ran
before `creep.js`'s own code, unlike the blob:-URL rewrite the first three
attempts relied on, which Chromium's SW registration restriction always
rejected) — confirmed by the Worker section reading the configured identity
where every previous capture read the real one.

**Result 2 — a second, narrower leak in the very same execution was NOT
fixed, and the reason isn't fully root-caused.** CreepJS's separate "WebGL"
report section — populated by `getWebglData()`, called from the *same*
`getWorkerData()` inside the *same* Service Worker execution, via an
`OffscreenCanvas` it creates itself — still reported the real GPU
(`Google Inc. (NVIDIA)` / RTX 4060) in **both** experiment runs, identical
to baseline, even though the injected core script includes the WebGL
`getParameter()` patch and that same script's navigator-override (the very
next statement after the WebGL patch in `buildCoreScript()`) demonstrably
did run and take effect. Two candidate explanations were identified but
**not** distinguished by further instrumentation this stage (unlike the
rigor the original Service Worker root-cause and the later WebGL-leak
root-cause both received — see above): either `self.WebGLRenderingContext`/
`WebGL2RenderingContext` are not yet defined as globals at the exact moment
`Runtime.evaluate` runs against a target paused this early (before its
realm is fully populated), or the specific `OffscreenCanvas`-obtained
context instance CreepJS reads from resolves `getParameter` through a path
this patch doesn't reach. Left as an open question, not a fixed sub-gap —
stated honestly rather than assumed away, since claiming this row without
distinguishing the two would repeat exactly the mistake the original WebGL
Service-Worker leak investigation was careful not to make.

**Result 3 — the specific concern this stage was asked to check first: did
CreepJS's "like headless" score get worse?** No — bit-identical across all
four runs (baseline ×2, experiment ×2), same hash (`11583836`) every time:
`44% like headless`. Whatever produces that composite score did not react
to this change at all.

**Result 4 — but a *different*, previously-unseen CreepJS signal appeared,
reproducibly.** CreepJS's separate "stealth" score, not previously discussed
anywhere in this document because it had never moved from `0%` in any prior
capture (including both this stage's own baseline runs): **`0% stealth` in
both baseline runs → `20% stealth` in both experiment runs**, a different
result hash each time (`0c019315` baseline vs. `4b82ddf4` experiment,
consistent across both repetitions of each). This is exactly the kind of
outcome this stage was told to check for and report honestly regardless of
whether it confirmed the hypothesis: a real, reproducible, new automation
tell that appeared specifically because of the browser-level CDP session —
not the metric named as the primary risk (`like headless`, which stayed
flat), but a sibling heuristic in the same detector that reacted where the
other one didn't, and reacted in the wrong direction.

**Result 5 — authenticated proxy support, the regression that killed all
three prior attempts, is genuinely NOT broken by this approach.** Verified
directly, twice, with a real fake-auth-proxy fixture (same shape as
`proxyVerification.spec.ts`'s own, run in combination with
`PF_E2E_SW_AUTOATTACH_EXPERIMENT=1` this time): the profile's real 407
challenge completed and authenticated correctly in both runs. This is
exactly the outcome the original hypothesis predicted — this mechanism
never touches `session.protocol.handle()` or any request/response
construction at all, so the interactive-auth restriction that doomed
`protocol.handle()` (see the three attempts above) simply never applies
here. The full existing `proxyVerification.spec.ts` suite (unmodified, flag
not set) was also re-run afterward to confirm no incidental regression from
the new code merely existing in the tree — 4/4 passed.

**Result 6 — no measurable performance cost.** CreepJS's own self-reported
total scan time (embedded in its report, not this project's timing) was
statistically indistinguishable between conditions: baseline 5606.5ms /
5159.3ms vs. experiment 5342.4ms / 5086.6ms — well within normal run-to-run
noise, if anything slightly faster on the experiment side, clearly not a
real regression either way.

**Decision: reverted, not shipped — a new, reproducible detection signal is
disqualifying under this stage's own stated decision rule, even though two
of the three named risk criteria (proxy-auth, `like headless`) came back
clean.** The instruction going into this stage was explicit: a new
CDP-detection trail is a negative outcome on its own, independent of
whether the specific named `like headless` metric moves. The `stealth`
score doing exactly that — moving from a value that had never once been
non-zero across every prior capture in `docs/creepjs-results/`, to a
consistent 20%, precisely when this browser-level CDP session is active —
is a new CDP-detection trail by that standard, even though it is also, in
every other respect, the closest any of the four attempts has come to
actually closing the underlying gap (Result 1 is real and reproducible, not
a partial illusion). `swAutoAttachExperiment.ts` was deleted;
`profileWindowEntry.ts` and `spoofingScript.ts` (whose only change was
exporting the already-existing `buildCoreScript()` instead of keeping it
module-private) were reverted to their pre-this-stage state; the temporary
`ws`/`@types/ws` dependency added only for this experiment's CDP client was
removed. No trace of this attempt remains in shipped code — only this
write-up, per the same policy the first three attempts were held to.

**What would need to be true to reconsider this.** Two separate open
questions, either of which could change the calculus: (a) root-causing
*why* the `stealth` heuristic reacted — if it turns out to be reacting to
something narrower than "a browser-level CDP session with
`Target.setAutoAttach` exists at all" (e.g. specifically
`waitForDebuggerOnStart`, or the `filter` parameter's shape, or the
`Runtime.evaluate` call itself rather than the attach), a narrower variant
might avoid it without giving up Result 1; this stage did not attempt that
narrowing — the first reproducible negative result was enough to stop and
report, per this stage's own instruction not to keep combining variations
after a disqualifying signal. (b) whether the structural cost noted above
(a permanent open CDP port on every profile, or automation-only coverage)
would even be acceptable if the detection question were resolved — not
evaluated in depth here since (a) wasn't cleared first. Neither is a
concrete next step recommended for immediate follow-up; both are recorded
so a future stage doesn't have to rediscover exactly where this one stopped.

## Fifth attempt — remove Service Worker entirely instead of patching it, real partial win, same stealth regression plus a new reliability gap, reverted

**A different class of fix than the first four.** Every prior attempt tried
to make a Service Worker's own global scope *report the configured
fingerprint correctly* — patching what it returns. This stage tried the
opposite: prevent Service Worker registration from being possible at all,
so there is nothing left to fingerprint through that path. Two mechanisms
were considered, per this stage's own instruction to check which behaves
more like a genuine absence rather than a patched one before committing to
either:

**Mechanism A — `--disable-blink-features=ServiceWorker`, tested and
rejected as non-functional.** This is a real Chromium command-line switch
category (Blink runtime-enabled features), and a first direct test — a
bare `BrowserWindow` loading a `data:text/html` URL — showed
`'serviceWorker' in navigator === false`, which looked like a clean,
engine-level win with zero JS footprint. **This result turned out to be a
false positive of the test method, not the mechanism.** A follow-up test
against a real `https://www.google.com` navigation, in an otherwise
identical bare `BrowserWindow` (no `<webview>` involved, ruling out
guest-view-specific causes), showed `navigator.serviceWorker` fully present
and functional despite the switch being confirmed active
(`app.commandLine.hasSwitch('disable-blink-features') === true`,
`getSwitchValue() === 'ServiceWorker'`, read back directly from inside the
real process). Root cause: `data:` URLs are opaque-origin documents that
Chromium suppresses `navigator.serviceWorker` on for an entirely unrelated
reason (Service Worker requires a real, non-opaque origin) — regardless of
any blink-features flag. The flag itself does nothing measurable to
`ServiceWorker`'s availability on a real page in this Chromium build
(128.0.6613.186), almost certainly because `ServiceWorker` graduated out of
experimental status years ago — Chromium's own feature-lifecycle convention
compiles a stable, shipped feature's runtime toggle away to a constant
`true`, specifically so it can no longer be disabled via this flag in
production builds. Verified directly, not inferred from documentation or
memory — this project's own build was tested both ways. This mechanism was
abandoned at this point; no further testing was done on it.

**Mechanism B — JS-level deletion of `Navigator.prototype.serviceWorker`,
the one this stage actually proceeded with.** Verified first, in isolation,
that the property is genuinely `configurable: true` on this Chromium build
(a real check, not assumed from the WebIDL spec) and that `delete
Navigator.prototype.serviceWorker` succeeds and produces a real absence —
`'serviceWorker' in navigator` becomes `false` and `typeof
navigator.serviceWorker` becomes `'undefined'`, the same as a genuinely
absent API, not a getter overridden to return `undefined` (which would
still show `true` for the `in` check — a real, detectable difference this
stage deliberately avoided). Implemented as one more conditional patch
inside `buildCoreScript()` in `spoofingScript.ts` (the exact same
injection mechanism as every other patch — Canvas/Audio/WebGL/fonts/
mediaDevices), guarded by `self.Navigator && self.Navigator.prototype` —
which naturally scopes the patch to the main document only, since
`self.Navigator` (the constructor) doesn't exist inside a Worker's global
at all (workers have `WorkerNavigator`, which never had a `serviceWorker`
property to begin with — Service Worker registration is always initiated
from the controlling document, never from inside a worker's own scope, so
propagating this patch into Worker contexts would be meaningless, not
merely redundant). Gated behind a new testing-only env var,
`PF_E2E_DISABLE_SW_EXPERIMENT=1`, same convention as every other
experimental switch in this document.

**Result 1 — the primary target (Worker-section GPU/UA/cores) is fixed,
more cleanly than the fourth attempt's partial fix.** With
`navigator.serviceWorker` genuinely absent, `navigator.serviceWorker.register(...)`
throws a `TypeError` on property access before CreepJS's own try/catch
around it can even attempt registration — and CreepJS's own documented
fallback ordering (Service Worker first, then `SharedWorker`, then a plain
`Worker`) takes over from there, landing on `SharedWorker`. Dedicated/
shared Worker propagation was **already** a solved, previously-verified
mechanism from an earlier stage of this document (`wrapWorkerCtor` in
`spoofingScript.ts`) — completely unrelated to anything built this stage —
so CreepJS's report simply inherits that already-correct path instead of
the broken Service-Worker one. Confirmed directly, twice: CreepJS's
"Worker" section (now labeled `SharedWorkerGlobalScope`, not
`ServiceWorkerGlobalScope`, in the raw capture) reported the exact
configured GPU vendor/renderer, User-Agent, `hardwareConcurrency`, and
`deviceMemory` in both experiment runs — verified field-by-field against
each run's own fingerprint-config table, not eyeballed. This is a cleaner
result than the fourth attempt's: no separate leftover leak in the same
execution the way the fourth attempt's WebGL sub-section was left broken.

**Result 2 — a separate, pre-existing "WebGL" report row is unaffected,
for better and worse.** CreepJS's distinct "WebGL" section (documented in
the fourth attempt as reading from an independent path, not clearly tied
to the Service-Worker-vs-SharedWorker fallback this stage's mechanism acts
on) still reported the real host GPU in this stage's captures too —
identical behavior to both the baseline and the fourth attempt. This is
**not a new cost of this stage** — it's the same pre-existing, independently
documented gap, unchanged either way, not made better or worse by removing
Service Worker.

**Result 3 — "like headless" unchanged again.** Bit-identical hash
(`11583836`, `44% like headless`) across every baseline and experiment run
this stage too — consistent with every attempt so far. Whatever produces
this composite score is not reacting to any of the four different
mechanisms tried across this document's five attempts.

**Result 4 — the same "stealth" regression reappeared, with the identical
result hash, despite a completely different mechanism.** `0% stealth` in
baseline, `20% stealth` in the experiment — and the result hash
(`4b82ddf4`) is **byte-identical to the fourth attempt's own experiment
hash**, even though this stage's mechanism has nothing in common with the
fourth's: no CDP session, no browser-level debugging, no
`Target.setAutoAttach`, nothing but a single JS property deletion executed
in the ordinary page-world injection path already used for every other
spoofing patch. That the two completely different mechanisms produce the
*exact same* stealth signature is itself informative, not just a repeated
bad result: it strongly suggests CreepJS's "stealth" heuristic is checking
something about Service Worker's *observable behavior* specifically (its
presence, or how registration resolves/fails) as one of its stealth-tool
signals, independent of *how* that behavior was altered — meaning this
entire *class* of fix (anything that makes Service Worker behave
differently from an untouched real browser, whether by hiding it, patching
it, or intercepting its registration) may be caught by this same detector
regardless of implementation, not just this stage's specific two
approaches. That is a hypothesis stated honestly as a hypothesis, not
verified further this stage (verifying it would need instrumenting
CreepJS's own minified stealth-check logic directly, which was not
attempted here).

**Result 5 — a new, real reliability gap: the patch is not 100% reliable
across real-world site navigation.** Three ordinary, real sites were
visited (not fixtures) to check for gross breakage — `https://web.dev/`
(itself a PWA, genuinely Service-Worker-dependent), `https://github.com/`,
and `https://www.wikipedia.org/` — each probed for `'serviceWorker' in
navigator` after a real navigation, run twice for reproducibility.
`web.dev` and `wikipedia.org` correctly showed `hasSW: false` in both
experiment runs; **`github.com` showed `hasSW: true` in both experiment
runs** — the deletion patch did not take effect on that specific site,
reproducibly. All three sites otherwise rendered real, substantial content
with no visible breakage in any condition (title, body text, and — for
GitHub — the actual homepage heading text all present and correctly
localized to the profile's configured language in every case, including
the failed-patch GitHub case). The most likely explanation, not
confirmed by further instrumentation: GitHub's homepage involves a
client-side locale-query-parameter redirect (`?locale=de-de` /
`?locale=fr-fr` were both observed, matching the profile's configured
locale) — an extra navigation step this project's preload-injected
"append a `<script>` tag" technique (deliberately chosen over CDP
`Page.addScriptToEvaluateOnNewDocument` during the earlier "CDP footprint
reduction" stage specifically to reduce CDP surface — see above) may not
consistently win a race against on every intermediate navigation the way a
true engine-level `addScriptToEvaluateOnNewDocument` guarantee would. This
was not root-caused with the same rigor as the original Service Worker gap
or the fourth attempt's WebGL sub-leak (no temporary instrumentation was
added to confirm the exact mechanism) — stated as an open, reproducible
observation, not a confirmed root cause, consistent with this document's
own standard of not asserting more than what was actually verified.

**Result 6 — authenticated proxy support unaffected, verified twice
directly** (same fake-auth-proxy fixture as every prior attempt, combined
with `PF_E2E_DISABLE_SW_EXPERIMENT=1`): the 407 challenge completed and
authenticated correctly in both runs — expected, since this mechanism
touches nothing on the network/protocol layer at all, only a page-world JS
property.

**Result 7 — no measurable performance cost**, consistent with every prior
attempt: CreepJS's own self-reported scan time was statistically
indistinguishable between baseline (4807.1ms / 4677.9ms) and experiment
(4870.3ms / 4801.4ms) runs.

**Decision: reverted, not shipped — the same disqualifying stealth-score
regression as the fourth attempt reappeared, now compounded by a real,
reproducible site-compatibility gap.** Even setting the stealth-score
question aside, a mitigation that silently doesn't apply on an ordinary,
extremely common real site (GitHub, not an edge case) while claiming to —
with no visible indication to the user that the patch didn't take effect
that time — is a real, additional problem an antidetect browser feature
cannot ship with quietly. Combined with Result 4's regression, this
attempt does not clear the bar either. `spoofingScript.ts`'s
`disableServiceWorker` field and patch, and `profileWindowEntry.ts`'s
wiring of `PF_E2E_DISABLE_SW_EXPERIMENT`, were both fully reverted — no
trace remains in shipped code, only this write-up.

**What this adds to the fourth attempt's open question.** The fourth
attempt's write-up asked whether the stealth-score reaction was specific
to "a browser-level CDP session exists" and left that unresolved. This
stage's result answers that question directly: **no** — the identical
stealth signature appeared from a mechanism with zero CDP involvement,
meaning the earlier hypothesis (narrow the CDP attach to avoid tripping the
heuristic) would not have helped even if pursued. The open question now is
narrower and harder: whatever CreepJS's stealth heuristic actually checks
about Service Worker, it reacted identically to "absent" and to "present
but paused/altered mid-registration" — two very different-looking states
from the mechanism's own perspective — which suggests it may be checking
something more fundamental (timing of registration relative to page load,
or the exact shape of a `register()` rejection, or something else not yet
identified) rather than any single implementation detail either of these
two stages touched. Resolving that would need reading CreepJS's own
(minified, third-party) stealth-check source directly — not attempted in
either stage — before a sixth attempt targeting Service Worker specifically
would have a real, non-speculative hypothesis to test, rather than another
guess-and-check mechanism variation.

## Sixth investigation — root-causing the stealth regression precisely (not a new mitigation attempt)

**What this was.** The fourth and fifth attempts' write-ups both ended on
the same open question, framed by that point as needing CreepJS's own
source read directly rather than guessed at. This stage did exactly that —
downloaded the real, current `creep.js` from
`https://abrahamjuliot.github.io/creepjs/creep.js` (not minified into one
line; a normal, readable ~9700-line file) and located the exact function
behind the "stealth" score, rather than continuing to infer it from
rendered output. This produced a specific, testable hypothesis —
`Function.prototype.toString` tamper-detection — which was then verified
empirically, not assumed either way. No new mitigation was built or
shipped this stage; this is a diagnosis, using attempt five's already-known
mechanism (re-applied temporarily, then reverted again) purely as a probe
to extract data the rendered page never showed before.

**What the source actually shows.** `getHeadlessFeatures()` computes a
`stealth` object with exactly five boolean keys — `hasIframeProxy`,
`hasHighChromeIndex`, `hasBadChromeRuntime`, `hasToStringProxy`, and
`hasBadWebGL` — and `stealthRating` is simply
`(number of true keys / 5) * 100`. A rating of exactly 20% therefore means
exactly one of these five flipped true; the rendered page has never shown
*which* one, only the aggregate percentage plus an opaque hash, which is
why this required reading the actual object, not just the score. Two of
the five keys are the ones the original hypothesis named:

- **`hasToStringProxy: (!!lieProps['Function.toString'])`** — reads a
  named entry from a much larger `lieProps` table, itself built once at
  page load by `getPrototypeLies()`, a generic scanner that walks a large
  set of prototype properties checking each for proxy-wrapping/native-code
  tampering. This is the check the original hypothesis pointed at.
- **`hasBadWebGL: (gpu && workerGPU && (gpu !== workerGPU))`** — a direct
  cross-context consistency check: `gpu` comes from
  `getCanvasWebgl()`'s own `UNMASKED_RENDERER_WEBGL` read (the same value
  CreepJS's separate "WebGL" report row displays), `workerGPU` from
  `getBestWorkerScope()`'s own reading (the same value the "Worker" report
  row displays) — this is CreepJS's own built-in check for exactly the
  class of inconsistency this document's fourth and fifth attempts
  produced: the worker-side GPU corrected, the other side not.

**Checking the existing, already-working patches for any toString
handling at all — there is none.** `grep`-ing `spoofingScript.ts` for any
`.toString` reference or "native code" string returns nothing. None of the
canvas, audio, WebGL, or navigator-identity overrides that have shipped
and stayed at `0% stealth` in every capture (including this document's own
very first CreepJS runs, long before any Service Worker attempt) spoof
`Function.prototype.toString` in any way — they are all plain
`proto.method = function () {...}` reassignments, exactly the shape a
prototype scanner's native-code check would normally flag if it were
actually catching this project's own patches. That every one of these
already-shipped, always-on overrides has consistently produced
`hasToStringProxy: false` (never once seen otherwise, across every capture
in `docs/creepjs-results/`) is itself strong evidence against the
hypothesis before even re-running anything: if lack of `toString`
spoofing were what `hasToStringProxy` catches, the very first baseline
capture — already running canvas noise, audio noise, and WebGL spoofing
by default — would have shown it too, and it never has.

**Empirical verification — the hypothesis is directly, conclusively
disconfirmed.** Attempt five's `disableServiceWorker` patch (JS deletion
of `Navigator.prototype.serviceWorker`) was reapplied verbatim, purely as
a probe, with one addition: instead of reading only
`document.body.innerText` (which excludes the stealth modal's contents,
since they render with `visibility: hidden` until clicked — the actual
reason no prior capture ever showed the per-key breakdown), the raw
`innerHTML` around the stealth modal's content was extracted directly.
Run three times for baseline and twice for the experiment condition, the
exact same five-key breakdown every time:

| Run | `hasIframeProxy` | `hasHighChromeIndex` | `hasBadChromeRuntime` | `hasToStringProxy` | `hasBadWebGL` | rating |
|---|---|---|---|---|---|---|
| Baseline ×3 | false | false | false | **false** | **false** | 0% |
| Experiment ×2 | false | false | false | **false** | **true** | 20% |

`hasToStringProxy` never once changed — `false` in every single run,
baseline and experiment alike. The only key that ever moved is
`hasBadWebGL`, exactly matching the mechanism traced from source before
any of this was run: with `navigator.serviceWorker` made absent, CreepJS
falls back to `SharedWorker` for its `workerGPU` reading (correctly
spoofed by this project's already-shipped Worker propagation), while `gpu`
(the separate "WebGL" report row, always real, unaffected by this or any
prior attempt) stays the real host GPU — a genuine, newly-created
mismatch between the two that didn't exist in the baseline, where *both*
sides leaked the same real GPU and therefore agreed with each other.

**A precise root cause for the long-standing "WebGL section" leak, as a
side effect of this investigation.** Tracing where `gpu` actually comes
from settled a question the fourth attempt's write-up left open ("not
clearly tied to the Service-Worker-vs-SharedWorker fallback"). `getCanvasWebgl()`
creates its probe canvas via `win = PHANTOM_DARKNESS` (falling back to the
real `window` only on Brave or if unavailable) and
`new win.OffscreenCanvas(256, 256)`. `PHANTOM_DARKNESS` — traced to
`getPhantomIframe()` — is a **real, hidden `<iframe>` CreepJS injects into
the page itself** (`document.body.appendChild` of a fragment containing
`<div style="[ghost/off-screen styles]"><iframe></iframe></div>`), and
`PHANTOM_DARKNESS` is that iframe's own `contentWindow`. An
`OffscreenCanvas` constructed via `new win.OffscreenCanvas(...)` where
`win` is a *different* window belongs to that window's own separate
realm — its own native `WebGLRenderingContext` constructor and prototype,
entirely distinct from the top-level webview document's. This project's
spoofing injection (`diagnosticsPreload.js`'s script-tag technique, plus
the `wrapWorkerCtor` propagation into Worker/SharedWorker) has never
reached into an iframe a *page itself* creates — only the webview's own
top document and the Workers it spawns. That gap, not any Service Worker
mechanism, is the actual, now-precisely-located reason CreepJS's separate
"WebGL" row has leaked the real GPU in every capture this whole document
has ever taken, including ones with no Service Worker experiment active
at all. Closing it would mean extending WebGL (and, for full consistency,
canvas/audio/navigator) propagation to reach same-page iframes — an
architecturally different, materially larger change than anything
attempted in this document's five prior stages, none of which touched
iframe propagation at all. Not attempted this stage; recorded here because
it is now a real, verified prerequisite for `hasBadWebGL` to ever read
`false` again with Service Worker's Worker-side leak also fixed — the two
attempts that fixed the worker side without also fixing this side are
exactly what exposed the mismatch this heuristic is built to catch.

**No code shipped from this investigation.** The temporarily reapplied
`disableServiceWorker` patch was reverted immediately after data
collection, the same as every prior stage — this section exists purely to
correct the record on *why* the stealth regression happens, with the
actual mechanism now verified rather than hypothesized, and to close out
the "final attempt in this direction" question the user posed: the
direction the hypothesis pointed in (spoof `toString` on whatever the
Service Worker patch touches) would not have helped, because nothing
about `Function.prototype.toString` was ever the trigger.

## Seventh attempt — patch WebGL inside the iframe too, SHIPPED as a profile setting (`serviceWorkerMode`)

**The real fix, found by acting on the sixth investigation's own root
cause instead of stopping at diagnosis.** The sixth investigation
identified, precisely, *why* `hasBadWebGL` flips true: fixing the Worker
side's GPU reporting (attempts four and five) while the separate,
pre-existing "WebGL" report row — read via an `OffscreenCanvas` inside a
hidden `<iframe>` CreepJS injects into the page itself, never previously
reached by this project's spoofing injection — still leaks the real GPU,
creates a mismatch that didn't exist in the honest, both-sides-real
baseline. The obvious next question, asked directly: **what if the iframe
side gets patched too?**

**Mechanism.** `spoofingScript.ts`'s existing `patchWebGL()` IIFE now
optionally includes a second sub-block, `propagateWebglToIframes()`, that:
finds every `<iframe>` already on the page and patches its
`WebGLRenderingContext`/`WebGL2RenderingContext` prototypes the same way
the main document's are patched; watches for new iframes via a
`MutationObserver`; and — the detail that mattered — recurses **into every
iframe's own `contentDocument`**, not just the top document. Reading
`getBehemothIframe()`'s actual source (see the sixth investigation) showed
CreepJS's real technique nests THREE levels deep below the top document
(iframe1 → iframeA → iframeB = `PHANTOM_DARKNESS`), not one; a
single-level observer patches the wrong (unused) iframe and silently does
nothing. `watchDoc()` is written to apply itself recursively to any depth
for exactly this reason.

**Critical constraint, verified empirically before shipping anything:**
this sub-block is included **only when `serviceWorkerMode` is also
`'disabled'`** — never when `webglSpoofingMode: 'spoof'` is on by itself
(which is every default profile). Tested directly: enabling the
iframe-WebGL patch alone, with Service Worker untouched, flips
`hasBadWebGL` from `false` to `true` in the *opposite* direction — main
thread now correctly spoofed, Service Worker side still leaking the real
GPU, same kind of new mismatch as before, same stealth regression. Only
combining both — closing the Service Worker side (deleting
`navigator.serviceWorker`, from the fifth attempt) *and* the iframe side
together — makes both sides agree again. `buildCoreScript()` builds the
iframe-propagation sub-script only when `fp.serviceWorkerMode ===
'disabled'`, textually nested inside the same `patchWebGL()` closure so it
shares its `patch()` helper and `VENDOR`/`RENDERER` constants — there was
never a risk of these two shipping independently by accident, since they
are one conditional block, not two independently-toggled ones.

**Empirical verification — the exact same clean-baseline stealth hash,
reproduced twice.** Real CreepJS runs, both conditions:

| Condition | Worker-section GPU | WebGL-section GPU | `hasBadWebGL` | stealth |
|---|---|---|---|---|
| Baseline (both off) | real | real | false | `0% stealth: 0c019315` |
| iframe patch alone, SW untouched | real | **configured** | **true** | `20% stealth: 4b82ddf4` (same hash as attempts 4 & 5) |
| Both together (shipped combination) | **configured** | **configured** | false | `0% stealth: 0c019315` — **identical hash to the clean baseline** |

Confirmed twice for the shipped combination, with different random
fingerprints each time (AMD Radeon RX 6600 and Intel UHD in the two runs)
— both runs' Worker-section and WebGL-section GPU strings matched each
other and the configured fingerprint exactly, and both produced the exact
`0c019315` hash. `44% like headless` stayed bit-identical across every
condition, consistent with every attempt so far.

**Full standard verification battery, same as every prior stage:**
- **Authenticated proxy support**: verified unaffected, twice, via the
  real shipped UI toggle (not a testing-only env var) combined with an
  authenticated-proxy profile — expected, since neither mechanism touches
  the network/protocol layer.
- **Real-site browsing**: `web.dev`, `github.com`, `wikipedia.org`, and
  `nytimes.com` (13 real, mostly cross-origin ad/embed iframes) all loaded
  full, substantial content with `serviceWorkerMode: 'disabled'` active —
  no errors, no visible breakage. The `MutationObserver`/iframe-patching
  code is wrapped in the same defensive `try`/`catch` pattern as every
  other patch in this file, so a cross-origin iframe throwing on property
  access (expected, harmless) doesn't propagate.
- **Performance**: CreepJS's own self-reported scan time showed no
  measurable cost from the additional patching (same-session comparisons
  stayed in the same range across conditions; absolute values varied more
  between *sessions* than between conditions within a session, consistent
  with ordinary machine-load noise this document has noted before).

**Shipped as a real, opt-in profile setting — `serviceWorkerMode: 'real' |
'disabled'`, default `'real'` (off, no behavior change for any existing or
new profile unless explicitly opted in).** Full wiring, matching
`webglSpoofingMode`'s own precedent exactly: a new
`ServiceWorkerModeSchema` field on `Fingerprint`
(`src/shared/schemas/fingerprint.ts`), migration
`011_service_worker_mode.sql`, `FingerprintRepository` read/write,
`generator.ts` default, `browserLauncher.ts`/`profileWindowEntry.ts`
plumbing (the testing-only `PF_E2E_DISABLE_SW_EXPERIMENT` env var used
during attempts five through seven's investigation phase is gone — this is
real per-profile configuration now, not a test flag), and a new toggle in
the Fingerprint tab's Spoofing panel (`FingerprintTab.tsx`) with the same
compatibility-risk warning-banner convention as the WebGL toggle: *"closes
a real fingerprint leak, but offline caching, push notifications, and
background sync will stop working on any site that relies on them"* — an
honest statement, not a hedge, since disabling Service Worker really does
remove that functionality wholesale, not selectively.

**A permanent E2E regression test**, not another throwaway investigation
script: `fingerprintEnforcement.spec.ts` gained a fixture that replicates
CreepJS's exact three-level nested-iframe structure (confirmed against the
real source, not approximated) and asserts the configured GPU is observed
through it — with one honest note about the fixture's own construction,
not the shipped mechanism: reading WebGL in the *exact same synchronous
tick* as building the nested iframes raced the `MutationObserver` (a
microtask) and observed the real GPU even though the live CreepJS site
(which has substantial async work between construction and use) did not —
the fixture was corrected to defer its read via `setTimeout`, matching how
a real page actually behaves, and is not a caveat about the real target
this fix was built for. `navigator.serviceWorker` absence is asserted the
same honest way as the fifth attempt (`'serviceWorker' in navigator ===
false`, not just a falsy read).

**What's still open, unrelated to this fix.** Fonts' CSS-measurement gap
and the WebRTC "best available, not true disable" limitation are
unchanged, as always. The fifth attempt's own separate finding — the
Service Worker deletion patch didn't reliably apply on `github.com`
specifically, likely an injection-timing race on a client-side
locale-redirect — is a real, independent reliability gap in the
`serviceWorkerMode: 'disabled'` mechanism itself, not resolved by this
stage, and not re-tested here since this stage's focus was the WebGL side
of the fix. A profile with this toggle on may therefore still leak via
Service Worker on some specific sites, even though the mechanism is
correct in general and verified against the real target (CreepJS) this
whole investigation was built around.

## Default flip — `serviceWorkerMode` is now `'disabled'` for every new profile, not opt-in

**The judgment call.** The seventh attempt shipped this as an opt-in
toggle, off by default, deliberately conservative pending real-world
verification. Once verified live against CreepJS twice with no
regression on the other named risks (proxy-auth, real-site browsing,
performance), leaving it off by default meant every new profile still
carried the exact correlatable leak this whole investigation exists to
close — the same reasoning, and the same reversal, `webglSpoofingMode`
went through earlier in this document's history: a silent leak on every
profile was judged the worse of the two real risks, once the fix was
actually proven rather than merely built.

`generateFingerprint()` (`src/main/fingerprint/generator.ts`) now sets
`serviceWorkerMode: 'disabled'` unconditionally for every newly generated
fingerprint. `webglSpoofingMode` was already `'spoof'` by default from
its own earlier stage, so a new profile today gets both mitigations
together automatically — exactly the combination the seventh attempt
proved necessary (either alone regresses `hasBadWebGL`). Existing
profiles created before this stage are unaffected (`serviceWorkerMode` is
a stored per-fingerprint column, not recomputed) — this only changes what
a *newly created* profile starts with.

**UI wording updated to match.** The Fingerprint tab's Service Worker
toggle's option labels and warning banner previously read as an opt-in
("Real (default, ...)" / "Disabled (experimental)"); now correctly say
"Real (Service Worker works normally)" / "Disabled (experimental,
default)", and the warning banner states "on by default" and points at
switching back to Real as the escape hatch, rather than reading as if the
user had just turned on something unusual. In the same pass, a genuinely
pre-existing, unrelated stale-text bug was found and fixed:
`webglSpoofingMode`'s own warning banner still said "Off by default" long
after that default flipped to `'spoof'` in an earlier stage — corrected
to "On by default" in both `en.ts` and `uk.ts` while in the area, since it
was directly adjacent and the same class of mistake this stage was about
to make if left unchecked.

**A real, useful side effect of broader real-site testing, not a new
regression.** Because this is no longer an opt-in path only a testing
profile ever exercised, a broader set of real sites was checked with a
completely default, untouched profile (no toggles set at all):
`web.dev`, `github.com`, `wikipedia.org`, `nytimes.com`, `twitter.com`
(redirects to `x.com`), `web.telegram.org`, `mail.google.com` (redirected
to a marketing page, not authenticated), and `reddit.com` (served a
bot-check challenge page, unrelated to this feature — Reddit does this to
many automated-looking clients regardless). All eight rendered real,
substantial content with no crashes and no broken pages. Two of the
eight — `github.com` and, newly observed, **`twitter.com`/`x.com`** —
showed `'serviceWorkerMode' in navigator === true` despite the default
now being `'disabled'`: the same reliability gap the fifth attempt found
on `github.com` alone, now confirmed on a second, unrelated site that
also happens to redirect at the top level during load (`twitter.com` →
`x.com`, same shape as `github.com`'s own locale-query-parameter
redirect). This strengthens rather than changes the fifth attempt's
existing hypothesis — a real pattern across at least two sites, not a
single site's quirk — and is picked up as evidence for the following
investigation rather than treated as a new, separate problem. No new
category of failure appeared (no crash, no broken rendering, no new
CreepJS-detectable signal, no proxy-auth regression) — this is the same
already-documented, already-queued gap, observed more broadly because
this stage looked at more real sites than any prior one did.

Every unit test asserting the old `'real'` default was updated to assert
`'disabled'` (`fingerprintGenerator.test.ts`); the E2E test that
demonstrated the original Service Worker leak by relying on the *default*
profile was restructured to explicitly opt back to `serviceWorkerMode:
'real'` first, since that leak is no longer the default behavior to
demonstrate — see `fingerprintEnforcement.spec.ts`'s "opting BACK to
serviceWorkerMode 'real'" test, which now serves as the opt-out
regression case rather than the default one.

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
