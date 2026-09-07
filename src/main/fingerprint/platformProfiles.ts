import type { Os } from '../../shared/schemas/fingerprint';

/**
 * Coherent hardware/OS bundles. The generator picks one bundle as a unit rather
 * than mixing independently-randomized OS/GPU/CPU values, so it cannot produce
 * contradictory combinations (e.g. a macOS platform string with an NVIDIA
 * Windows-only WebGL renderer).
 */
export interface PlatformProfile {
  os: Os;
  /** Kept for backward compatibility with anything reading a single
   * osVersion off a generated fingerprint — always osVersions[0]. */
  osVersion: string;
  /** Realistic, selectable OS versions for this platform — explicit UI
   * choice picks one directly instead of the generator always defaulting
   * to osVersions[0]. */
  osVersions: string[];
  platform: string;
  browserVersion: string;
  /** `deviceScaleFactor` here is OPTIONAL per screen: when a real device's
   * DPR is tightly coupled to its exact model (every mobile bundle below),
   * setting it here picks screen and DPR together as one coherent unit —
   * the same "one bundle, not independently randomized fields" principle
   * this whole file is built on, just applied one level deeper. Desktop
   * bundles leave it unset and fall back to `deviceScaleFactorOptions`
   * (picked independently, since desktop DPR is only loosely coupled to
   * resolution — a 1920x1080 external monitor and a 1920x1080 laptop panel
   * are both completely normal at 100% scaling). */
  screens: Array<{ width: number; height: number; deviceScaleFactor?: number }>;
  /** Used only for screens that don't carry their own deviceScaleFactor. */
  deviceScaleFactorOptions: number[];
  hardwareConcurrencyOptions: number[];
  deviceMemoryOptions: number[];
  gpuOptions: Array<{ vendor: string; renderer: string }>;
  /** navigator.maxTouchPoints — see FingerprintSchema's own field comment. */
  maxTouchPoints: number;
}

/** Chrome versions offered for explicit selection — shared across OSes
 * (the browser version isn't OS-specific the way GPU/platform strings
 * are). Kept in sync with browserCompatibility.ts's own notion of "current".*/
export const BROWSER_VERSIONS: string[] = ['126.0.0.0', '127.0.0.0', '128.0.0.0'];

export const PLATFORM_PROFILES: PlatformProfile[] = [
  {
    os: 'windows',
    osVersion: '10.0',
    osVersions: ['10.0', '11.0'],
    platform: 'Win32',
    browserVersion: '128.0.0.0',
    screens: [
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
      { width: 1366, height: 768 },
    ],
    deviceScaleFactorOptions: [1],
    hardwareConcurrencyOptions: [4, 8, 12, 16],
    deviceMemoryOptions: [8, 16, 32],
    gpuOptions: [
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)' },
    ],
    maxTouchPoints: 0,
  },
  {
    os: 'macos',
    osVersion: '14.5',
    osVersions: ['13.6', '14.5', '15.1'],
    platform: 'MacIntel',
    browserVersion: '128.0.0.0',
    screens: [
      { width: 1440, height: 900 },
      { width: 2560, height: 1600 },
    ],
    deviceScaleFactorOptions: [2],
    hardwareConcurrencyOptions: [8, 10],
    deviceMemoryOptions: [8, 16],
    gpuOptions: [
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)' },
    ],
    maxTouchPoints: 0,
  },
  {
    os: 'linux',
    osVersion: 'x86_64',
    osVersions: ['x86_64'],
    platform: 'Linux x86_64',
    browserVersion: '128.0.0.0',
    screens: [
      { width: 1920, height: 1080 },
      { width: 1600, height: 900 },
    ],
    deviceScaleFactorOptions: [1],
    hardwareConcurrencyOptions: [4, 8],
    deviceMemoryOptions: [8, 16],
    gpuOptions: [
      { vendor: 'Google Inc. (Mesa)', renderer: 'ANGLE (Mesa, llvmpipe, OpenGL 4.5)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics, OpenGL 4.6)' },
    ],
    maxTouchPoints: 0,
  },
  {
    // Real Chrome for Android IS genuine Chromium (the same Blink/V8 engine
    // as desktop, just a mobile build) — a spoofed Android profile has the
    // same category of risk as the desktop bundles above (a real Chromium
    // presenting different UA/platform/CDP-emulated-device-metrics fields),
    // not a new, worse one. `navigator.platform` on real Chrome-for-Android
    // reports "Linux armv8l" (not e.g. "Android"), confirmed real-device
    // behavior, not a guess.
    os: 'android',
    osVersion: '14',
    osVersions: ['13', '14', '15'],
    platform: 'Linux armv8l',
    browserVersion: '128.0.0.0',
    screens: [
      // Pixel 7, Samsung Galaxy S23, OnePlus 11 — real published CSS
      // viewport sizes and DPRs for each, kept paired (not independently
      // randomized) since a real device's DPR is fixed by its model.
      { width: 412, height: 915, deviceScaleFactor: 2.625 },
      { width: 360, height: 780, deviceScaleFactor: 3 },
      { width: 412, height: 919, deviceScaleFactor: 2.625 },
    ],
    deviceScaleFactorOptions: [2.625], // unused: every screen above carries its own
    hardwareConcurrencyOptions: [4, 6, 8],
    deviceMemoryOptions: [4, 6, 8],
    gpuOptions: [
      { vendor: 'Google Inc. (Qualcomm)', renderer: 'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)' },
      { vendor: 'Google Inc. (ARM)', renderer: 'ANGLE (ARM, Mali-G715-Immortalis MC11, OpenGL ES 3.2)' },
      { vendor: 'Google Inc. (Qualcomm)', renderer: 'ANGLE (Qualcomm, Adreno (TM) 730, OpenGL ES 3.2)' },
    ],
    // Real touchscreen Android devices report 5.
    maxTouchPoints: 5,
  },
  {
    // Honest limitation, not glossed over — see docs/FINGERPRINT_AUDIT.md's
    // "Tenth investigation" for the full account: Apple requires every iOS
    // browser (including Chrome/Firefox for iOS) to use WebKit, never its
    // own engine — there is no real device where a Chromium/V8/Blink engine
    // presents an iOS User-Agent. This bundle spoofs every JS-visible field
    // this project can reach (UA, platform, screen, touch points), the same
    // as every other bundle, but the underlying rendering/JS engine is
    // still genuinely Chromium — a categorically deeper mismatch than any
    // other OS this project spoofs, since those are all real Chromium
    // presenting as a different real Chromium. Included because it was
    // explicitly requested, not because it is claimed to be as trustworthy
    // as the bundles above.
    os: 'ios',
    osVersion: '17',
    osVersions: ['16', '17', '18'],
    platform: 'iPhone',
    browserVersion: '128.0.0.0',
    screens: [
      // iPhone SE (3rd gen), iPhone 14, iPhone 15 Pro Max — real published
      // CSS viewport sizes and DPRs, paired per real model.
      { width: 375, height: 667, deviceScaleFactor: 2 },
      { width: 390, height: 844, deviceScaleFactor: 3 },
      { width: 430, height: 932, deviceScaleFactor: 3 },
    ],
    deviceScaleFactorOptions: [3], // unused: every screen above carries its own
    // Every modern iPhone (A15 and later) reports 6 via navigator.hardwareConcurrency.
    hardwareConcurrencyOptions: [6],
    // Real iOS Safari/WebKit does not implement the Device Memory API at
    // all — navigator.deviceMemory is simply undefined on a real iPhone,
    // not a small/large number. This project's schema requires a definite
    // number for every profile regardless of OS, so this value exists for
    // internal coherence but does not match what a real iOS browser would
    // report (the field wouldn't exist at all) — see the Tenth
    // investigation entry above for why this isn't silently presented as
    // solved.
    deviceMemoryOptions: [4, 6],
    // Real WebKit's WebGL renderer strings look nothing like Chromium's
    // ANGLE-prefixed ones — this project's Chromium engine always reports
    // an ANGLE string regardless of claimed OS, so these are the closest
    // coherent-with-Apple-hardware values available, not a real capture
    // from an iPhone's actual Safari.
    gpuOptions: [
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple A16 GPU, OpenGL ES 3.2)' },
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple A17 Pro GPU, OpenGL ES 3.2)' },
    ],
    // Real iPhones report 5.
    maxTouchPoints: 5,
  },
];

export interface LocaleProfile {
  locale: string;
  languages: string[];
  timezone: string;
  /** The real city the timezone above actually corresponds to — coherent
   * with locale/timezone by construction, not an independently random
   * point, same "pick one bundle, don't mix fields" principle as
   * PlatformProfile. Used for `geolocationMode: 'spoof'` (see
   * fingerprintEnforcement.ts). */
  latitude: number;
  longitude: number;
}

export const LOCALE_PROFILES: LocaleProfile[] = [
  { locale: 'en-US', languages: ['en-US', 'en'], timezone: 'America/New_York', latitude: 40.7128, longitude: -74.006 },
  { locale: 'en-GB', languages: ['en-GB', 'en'], timezone: 'Europe/London', latitude: 51.5074, longitude: -0.1278 },
  { locale: 'de-DE', languages: ['de-DE', 'de', 'en'], timezone: 'Europe/Berlin', latitude: 52.52, longitude: 13.405 },
  { locale: 'fr-FR', languages: ['fr-FR', 'fr', 'en'], timezone: 'Europe/Paris', latitude: 48.8566, longitude: 2.3522 },
  { locale: 'uk-UA', languages: ['uk-UA', 'uk', 'en'], timezone: 'Europe/Kyiv', latitude: 50.4501, longitude: 30.5234 },
];

export function buildUserAgent(profile: PlatformProfile): string {
  const chromiumUa = `Chrome/${profile.browserVersion} Safari/537.36`;
  if (profile.os === 'windows') {
    return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${chromiumUa}`;
  }
  if (profile.os === 'macos') {
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) ${chromiumUa}`;
  }
  if (profile.os === 'android') {
    // Real Chrome-for-Android UA includes the specific device model — kept
    // generic ("K", the real placeholder some Android UAs use for an
    // unspecified/build device) rather than picking one hardcoded model
    // name independent of the actual screen/GPU bundle chosen, which would
    // itself be a coherence gap.
    return `Mozilla/5.0 (Linux; Android ${profile.osVersion}; K) AppleWebKit/537.36 (KHTML, like Gecko) ${chromiumUa} Mobile`;
  }
  if (profile.os === 'ios') {
    // See this bundle's own top comment: this UA claims Chrome-for-iOS
    // ("CriOS"), matching what a real iOS Chrome UA string looks like —
    // the honest limitation is the underlying engine, not this string.
    const webkitVersion = '605.1.15';
    return `Mozilla/5.0 (iPhone; CPU iPhone OS ${profile.osVersion.replace('.', '_')}_0 like Mac OS X) AppleWebKit/${webkitVersion} (KHTML, like Gecko) CriOS/${profile.browserVersion.split('.')[0]}.0.0.0 Mobile/15E148 Safari/${webkitVersion}`;
  }
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ${chromiumUa}`;
}
