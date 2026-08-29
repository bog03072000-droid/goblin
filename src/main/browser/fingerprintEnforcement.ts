import type { WebContents } from 'electron';
import type { WebrtcMode } from '../../shared/schemas/fingerprint';

export interface EnforceableFingerprint {
  userAgent: string;
  platform: string;
  languages: string[];
  hardwareConcurrency: number;
  screenWidth: number;
  screenHeight: number;
  deviceScaleFactor: number;
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
