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
