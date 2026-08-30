import { randomUUID } from 'node:crypto';
import type { FingerprintInput } from '../../shared/schemas/fingerprint';
import { PLATFORM_PROFILES, LOCALE_PROFILES, buildUserAgent } from './platformProfiles';
import { createSeededRandom, pick } from './seededRandom';

export interface GenerateFingerprintOptions {
  seed: string;
  os?: 'windows' | 'macos' | 'linux';
  locale?: string;
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

  const screen = pick(rng, platform.screens);
  const gpu = pick(rng, platform.gpuOptions);
  const hardwareConcurrency = pick(rng, platform.hardwareConcurrencyOptions);
  const deviceMemory = pick(rng, platform.deviceMemoryOptions);

  return {
    name: `${platform.os}-${locale.locale}-${options.seed.slice(0, 8)}`,
    os: platform.os,
    osVersion: platform.osVersion,
    browserVersion: platform.browserVersion,
    userAgent: buildUserAgent(platform),
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
    // Off by default — a JS-level getParameter() override carries real
    // compatibility risk for WebGL-heavy sites (see docs/FINGERPRINT_AUDIT.md).
    // The user opts in per profile via the Fingerprint tab.
    webglSpoofingMode: 'off',
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
