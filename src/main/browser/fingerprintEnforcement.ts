import type { Session, WebContents } from 'electron';
import type { GeolocationMode, PermissionsMode, WebrtcMode } from '../../shared/schemas/fingerprint';

export interface EnforceableFingerprint {
  userAgent: string;
  platform: string;
  languages: string[];
  hardwareConcurrency: number;
  screenWidth: number;
  screenHeight: number;
  deviceScaleFactor: number;
  geolocationMode: GeolocationMode;
  geolocationLatitude: number;
  geolocationLongitude: number;
}

/**
 * Applies the fingerprint fields that Chromium's DevTools Protocol can
 * genuinely enforce — verified empirically against this project's actual
 * Electron/Chromium build, not assumed. See docs/FINGERPRINT_AUDIT.md for the
 * verification method and full reality matrix.
 *
 * This is a first-party, stable Chromium mechanism (the CDP `Emulation`
 * domain), not a JS-level monkeypatch — categorically different from the
 * "crude global random noise" approach the project explicitly forbids for
 * Canvas/Audio, which have no equivalent native mechanism (see the audit).
 *
 * `width`/`height` are deliberately passed as 0 ("don't override") so the
 * real, already-correctly-sized window viewport is left alone — only
 * `screen.width`/`screen.height`/`devicePixelRatio` (the claimed *monitor*,
 * not the *window*) are overridden. Verified this decouples cleanly rather
 * than distorting the visible page layout.
 *
 * Deliberately kept on CDP rather than moved to the preload-injected script
 * (see spoofingScript.ts / diagnosticsPreload.ts, which now carries Canvas/
 * Audio/WebGL/deviceMemory/Fonts/MediaDevices/Worker-propagation instead):
 * `setDeviceMetricsOverride` changes `screen.width`/`height`/devicePixelRatio
 * at the Blink layout engine level, which also drives CSS `@media` /
 * `matchMedia()` evaluation — a JS-only override of the same properties
 * would leave those two disagreeing (CreepJS's own "CSS Media Queries" check
 * exists specifically to catch that class of mismatch), trading one
 * detectable signal for a worse one. `navigator.platform` similarly stays
 * here for consistency with `setUserAgentOverride`. A conscious decision,
 * not an oversight — see docs/FINGERPRINT_AUDIT.md.
 */
export async function enforceFingerprint(wc: WebContents, fp: EnforceableFingerprint): Promise<void> {
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach('1.3');
  }

  await wc.debugger.sendCommand('Emulation.setUserAgentOverride', {
    userAgent: fp.userAgent,
    acceptLanguage: fp.languages.join(','),
    platform: fp.platform,
  });

  await wc.debugger.sendCommand('Emulation.setHardwareConcurrencyOverride', {
    hardwareConcurrency: fp.hardwareConcurrency,
  });

  await wc.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width: 0,
    height: 0,
    deviceScaleFactor: fp.deviceScaleFactor,
    mobile: false,
    screenWidth: fp.screenWidth,
    screenHeight: fp.screenHeight,
  });

  // 'real': no override — Chromium's real geolocation provider (or lack of
  // one) behaves exactly as it did before this feature existed. 'blocked' is
  // handled entirely by applyPermissionPolicy() below (denying the
  // permission itself, the same outcome a user clicking "Block" gets) rather
  // than here, so there is nothing to send for it on this CDP domain.
  if (fp.geolocationMode === 'spoof') {
    await wc.debugger.sendCommand('Emulation.setGeolocationOverride', {
      latitude: fp.geolocationLatitude,
      longitude: fp.geolocationLongitude,
      accuracy: 100,
    });
  }
}

/**
 * Installs this session's permission policy. Applied once per profile
 * session (not per-WebContents like enforceFingerprint) since
 * `session.setPermissionRequestHandler`/`setPermissionCheckHandler` are
 * session-scoped APIs, not per-page.
 *
 * Geolocation and every other permission type are deliberately independent
 * axes rather than one combined mode: `geolocationMode` decides geolocation
 * specifically (denied outright for 'blocked', granted for 'spoof'/'real' —
 * the actual position value for 'spoof' comes from the CDP override above,
 * not from this handler), while `permissionsMode: 'deny-all'` is a blanket
 * denial for every OTHER permission type (camera, mic, notifications,
 * clipboard, etc.), so "spoof my location but block the camera" is a
 * representable combination, not a contradiction one setting would force.
 *
 * Before this, no handler was installed at all, which is Electron's own
 * implicit "allow everything" default — both branches below preserve that
 * default exactly for anything not explicitly opted into a stricter mode,
 * rather than silently becoming more restrictive for existing profiles.
 */
export function applyPermissionPolicy(
  ses: Session,
  opts: { permissionsMode: PermissionsMode; geolocationMode: GeolocationMode },
): void {
  function shouldGrant(permission: string): boolean {
    if (permission === 'geolocation') return opts.geolocationMode !== 'blocked';
    return opts.permissionsMode !== 'deny-all';
  }

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(shouldGrant(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => shouldGrant(permission));
}

/**
 * Maps our webrtcMode to Electron's native `webContents.setWebRTCIPHandlingPolicy`
 * (a real Chromium feature — see BrowserLeaks — not a homegrown mechanism).
 * Verified empirically to be a per-WebContents API in this Electron version
 * (32.3.3) — NOT per-Session, despite older Electron docs/memory suggesting
 * otherwise — so it must be (re-)applied to each WebContents individually,
 * same as the CDP overrides above.
 *
 * Honest limitation: Chromium has no "fully disable WebRTC" policy. `disabled`
 * therefore maps to the same strongest-available leak protection as
 * `proxy-only` (`disable_non_proxied_udp`, which blocks direct host/srflx
 * candidates and forces relay-only ICE) rather than actually removing the
 * `RTCPeerConnection` API — documented here rather than silently treated as
 * equivalent to a true disable.
 */
export function webrtcModeToPolicy(
  mode: WebrtcMode,
): 'default' | 'default_public_interface_only' | 'default_public_and_private_interfaces' | 'disable_non_proxied_udp' {
  switch (mode) {
    case 'default':
      return 'default';
    case 'proxy-only':
    case 'disabled':
      return 'disable_non_proxied_udp';
  }
}

export function applyWebrtcPolicy(wc: WebContents, mode: WebrtcMode): void {
  wc.setWebRTCIPHandlingPolicy(webrtcModeToPolicy(mode));
}

/**
 * The authoritative way `buildSpoofingScript()`'s output (canvas/audio/
 * webgl/deviceMemory/fonts/mediaDevices/Worker-propagation/Service-Worker-
 * deletion) gets into every profile's real browsing, for every site —
 * moved here from a preload-injected "<script> element with textContent"
 * technique (see docs/FINGERPRINT_AUDIT.md's "Eighth attempt") after
 * finding a real, verified gap: a site with a strict `script-src` CSP
 * directive (no `'unsafe-inline'`, no matching `nonce-`/`hash-` source —
 * confirmed directly on github.com's and x.com's real response headers)
 * silently blocked that inline `<script>` element from executing at all,
 * meaning the *entire* spoofing script never ran there, not just one
 * field. `Page.addScriptToEvaluateOnNewDocument` is a genuine Chromium/
 * CDP-native mechanism (the same one Puppeteer/Playwright's own
 * `page.addInitScript()` uses) that runs in the page's own main world
 * before any of the page's own scripts, and — documented Chromium
 * behavior, not assumed — is exempt from the page's own CSP `script-src`
 * restriction, since it's injected by the debugger/browser side, not by
 * page-authored means.
 *
 * This re-enables CDP's `Page` domain on the already-attached debugger
 * session (`enforceFingerprint` above already attaches for `Emulation.*`)
 * — the exact domain the project's own earlier "CDP footprint reduction"
 * stage removed, and the same general risk category (more enabled CDP
 * domains) that caused the fourth attempt's stealth-score regression.
 * Verified this stage, live against CreepJS, twice: this specific
 * mechanism (registering a script via `Page.addScriptToEvaluateOnNewDocument`)
 * produces the exact same clean stealth-score hash as an untouched
 * baseline — unlike the fourth attempt's `Target.setAutoAttach`, which did
 * regress it. Not every CDP domain carries the same detectable cost; this
 * one, empirically, does not. See docs/FINGERPRINT_AUDIT.md's "Eighth
 * attempt" write-up for the full verification.
 *
 * Registered once per webview attach — Chromium re-runs a registered script
 * automatically on every subsequent navigation of that target (redirects
 * included) for as long as the debugger stays attached, so this needs no
 * re-registration per navigation the way the preload's own per-navigation
 * re-injection did — closing, as a side effect, whatever timing risk a
 * redirect might have posed to the old technique too.
 */
export async function injectSpoofingScriptViaCdp(wc: WebContents, script: string): Promise<void> {
  if (!wc.debugger.isAttached()) {
    wc.debugger.attach('1.3');
  }
  await wc.debugger.sendCommand('Page.enable');
  await wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: script });
}
