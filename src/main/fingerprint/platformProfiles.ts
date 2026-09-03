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
  screens: Array<{ width: number; height: number }>;
  hardwareConcurrencyOptions: number[];
  deviceMemoryOptions: number[];
  gpuOptions: Array<{ vendor: string; renderer: string }>;
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
    hardwareConcurrencyOptions: [4, 8, 12, 16],
    deviceMemoryOptions: [8, 16, 32],
    gpuOptions: [
      { vendor: 'Google Inc. (NVIDIA)', renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0)' },
      { vendor: 'Google Inc. (AMD)', renderer: 'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0)' },
    ],
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
    hardwareConcurrencyOptions: [8, 10],
    deviceMemoryOptions: [8, 16],
    gpuOptions: [
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M2, OpenGL 4.1)' },
      { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)' },
    ],
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
    hardwareConcurrencyOptions: [4, 8],
    deviceMemoryOptions: [8, 16],
    gpuOptions: [
      { vendor: 'Google Inc. (Mesa)', renderer: 'ANGLE (Mesa, llvmpipe, OpenGL 4.5)' },
      { vendor: 'Google Inc. (Intel)', renderer: 'ANGLE (Intel, Mesa Intel(R) UHD Graphics, OpenGL 4.6)' },
    ],
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
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) ${chromiumUa}`;
}
