import { randomUUID } from 'node:crypto';
import type { FingerprintInput } from '../../shared/schemas/fingerprint';
import { PLATFORM_PROFILES, LOCALE_PROFILES, buildUserAgent } from './platformProfiles';
import { createSeededRandom, pick } from './seededRandom';

export interface GenerateFingerprintOptions {
  seed: string;
  os?: 'windows' | 'macos' | 'linux';
  locale?: string;
  /** Explicit field overrides for the "choose instead of Auto" UI — each is
   * validated to actually belong to the resolved platform bundle where that
   * matters (osVersion/gpu/screen), so a caller can't request e.g. an Apple
   * GPU on a Windows profile through this path; an override that doesn't
   * belong to the resolved OS is silently ignored (falls back to a random
   * pick from that OS's own options) rather than producing an incoherent
   * fingerprint or throwing on a stale UI selection. */
  osVersion?: string;
  browserVersion?: string;
  screenWidth?: number;
  screenHeight?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  webglVendor?: string;
  webglRenderer?: string;
}

/**
 * Generates a coherent fingerprint by picking one full platform bundle and one
 * full locale bundle as units (never mixing independently-randomized fields),
 * so OS/GPU/UA/platform-string stay mutually consistent. Deterministic per seed.
 */
export function generateFingerprint(options: GenerateFingerprintOptions): FingerprintInput {
  const rng = createSeededRandom(options.seed);

  const platformCandidates = options.os
    ? PLATFORM_PROFILES.filter((p) => p.os === options.os)
    : PLATFORM_PROFILES;
  const platform = pick(rng, platformCandidates.length ? platformCandidates : PLATFORM_PROFILES);

  const localeCandidates = options.locale
    ? LOCALE_PROFILES.filter((l) => l.locale === options.locale)
    : LOCALE_PROFILES;
  const locale = pick(rng, localeCandidates.length ? localeCandidates : LOCALE_PROFILES);

  // Each override is validated against this resolved platform's own real
  // option lists rather than trusted blindly — see the option's own comment
  // on GenerateFingerprintOptions for why (never lets a stale/foreign UI
  // selection produce an incoherent fingerprint).
  const screenOverride =
    options.screenWidth != null && options.screenHeight != null
      ? platform.screens.find((s) => s.width === options.screenWidth && s.height === options.screenHeight)
      : undefined;
  const screen = screenOverride ?? pick(rng, platform.screens);

  const gpuOverride =
    options.webglVendor != null
      ? platform.gpuOptions.find(
          (g) => g.vendor === options.webglVendor && (options.webglRenderer == null || g.renderer === options.webglRenderer),
        )
      : undefined;
  const gpu = gpuOverride ?? pick(rng, platform.gpuOptions);

  const hardwareConcurrency =
    options.hardwareConcurrency != null && platform.hardwareConcurrencyOptions.includes(options.hardwareConcurrency)
      ? options.hardwareConcurrency
      : pick(rng, platform.hardwareConcurrencyOptions);
  const deviceMemory =
    options.deviceMemory != null && platform.deviceMemoryOptions.includes(options.deviceMemory)
      ? options.deviceMemory
      : pick(rng, platform.deviceMemoryOptions);
  const osVersion =
    options.osVersion != null && platform.osVersions.includes(options.osVersion) ? options.osVersion : platform.osVersion;
  const browserVersion = options.browserVersion ?? platform.browserVersion;

  return {
    name: `${platform.os}-${locale.locale}-${options.seed.slice(0, 8)}`,
    os: platform.os,
    osVersion,
    browserVersion,
    userAgent: buildUserAgent({ ...platform, browserVersion }),
    platform: platform.platform,
    locale: locale.locale,
    languages: locale.languages,
    timezone: locale.timezone,
    screenWidth: screen.width,
    screenHeight: screen.height,
    deviceScaleFactor: platform.os === 'macos' ? 2 : 1,
    hardwareConcurrency,
    deviceMemory,
    webglVendor: gpu.vendor,
    webglRenderer: gpu.renderer,
    canvasMode: 'noise',
    audioMode: 'noise',
    webrtcMode: 'proxy-only',
    fontsMode: 'system',
    mediaDevicesMode: 'real',
    // Spoofed by default — leaving this off meant every new profile exposed
    // the real host GPU renderer regardless of the rest of the fingerprint,
    // the single largest practical detection gap (see docs/FINGERPRINT_AUDIT.md).
    // The user can still opt out per profile via the Fingerprint tab.
    webglSpoofingMode: 'spoof',
    // Off by default (unlike webglSpoofingMode): unlike a real GPU leaking
    // through unconditionally, a site simply doesn't ask for geolocation
    // unless the user interacts with a feature that needs it, so there's no
    // equivalent "silently leaks on every profile" default gap to close —
    // see docs/FINGERPRINT_AUDIT.md before changing this default.
    geolocationMode: 'real',
    geolocationLatitude: locale.latitude,
    geolocationLongitude: locale.longitude,
    permissionsMode: 'real',
    // Disabled by default, same reasoning and same later reversal as
    // webglSpoofingMode above: leaving this "real" meant every new profile
    // silently leaked a correlatable real GPU/core fingerprint through
    // Service Worker + iframe-WebGL (see docs/FINGERPRINT_AUDIT.md's
    // "Seventh attempt" — verified closed, live, against CreepJS, twice) —
    // a silent leak on every profile was judged the worse of the two real
    // risks, exactly the judgment call that flipped webglSpoofingMode's own
    // default earlier. The real, stated compatibility cost (offline
    // caching, push notifications, background sync stop working on any
    // site that actually uses a Service Worker) hasn't changed and hasn't
    // gone away — the user can still opt back to 'real' per profile via
    // the Fingerprint tab, same as webglSpoofingMode's own opt-out.
    serviceWorkerMode: 'disabled',
    seed: options.seed,
  };
}

export function cloneFingerprint(fp: FingerprintInput, newSeed: string): FingerprintInput {
  return { ...fp, seed: newSeed, name: `${fp.name}-clone-${randomUUID().slice(0, 8)}` };
}

export function compareFingerprints(a: FingerprintInput, b: FingerprintInput): string[] {
  const diffs: string[] = [];
  for (const key of Object.keys(a) as Array<keyof FingerprintInput>) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      diffs.push(String(key));
    }
  }
  return diffs;
}
