import { z } from 'zod';
import type { FingerprintInput } from '../../shared/schemas/fingerprint';
import { EXPORT_FORMAT, EXPORT_VERSION, type ProfileExport } from '../../shared/schemas/exportFormat';
import { generateFingerprint } from '../fingerprint/generator';
import { validateFingerprint } from '../fingerprint/validator';

/**
 * Importing a competitor's export is fundamentally different from importing
 * this app's own (`ProfileExportSchema.parse()` in importExport.ts): our own
 * format is a 1:1 serialization of our own Fingerprint type, so parsing it
 * back is lossless by construction. A competitor's format was never designed
 * to round-trip through OUR schema, and — critically — several of it fields
 * (WebGL vendor/renderer spoofing behavior, canvas/audio noise mode, exact
 * timezone) are either unconfirmed from public documentation or represent a
 * DIFFERENT product's own spoofing implementation, not a portable value.
 * Inventing field names for what wasn't confirmed would silently either
 * crash on real exports or, worse, silently ignore real user data without
 * any error — both worse than being explicit about what actually transfers.
 *
 * The approach taken here: only map fields whose name/shape is confirmed
 * from a vendor's own public documentation (cited per-vendor below), and
 * fill everything else from this project's own `generateFingerprint()` —
 * the same coherent, already-audited bundle every profile created directly
 * in this app gets — so an imported profile is never a half-formed,
 * internally-inconsistent mix of guesses. This is a deliberate, stated
 * trade-off: identity fields (User-Agent, platform, screen, CPU/RAM/touch)
 * transfer; everything else adopts this project's own defaults rather than
 * a guessed competitor equivalent.
 */

export class CompetitorImportError extends Error {}

/**
 * GoLogin's own documented profile JSON shape (confirmed via
 * https://gologin.com/docs/api-reference/profile/update-profile, 2026-09 —
 * the `navigator` sub-object's field names and the top-level `os`/`name`
 * are exactly as GoLogin's own docs show for creating/updating a profile;
 * this project's own export/import round-trips through the same
 * request/response shape GoLogin's API itself uses). Every field here is
 * `.optional()` — a real export may omit some of these, and a profile
 * missing all of them is still recoverable via generateFingerprint()'s own
 * defaults, just with less carried over from the source.
 */
const GoLoginNavigatorSchema = z.object({
  userAgent: z.string().min(1).optional(),
  resolution: z.string().optional(), // "1920x1080"
  language: z.string().optional(),
  platform: z.string().optional(),
  hardwareConcurrency: z.number().int().positive().optional(),
  deviceMemory: z.number().int().positive().optional(),
  maxTouchPoints: z.number().int().min(0).optional(),
});

const GoLoginOsSchema = z.enum(['win', 'mac', 'lin']);

const GoLoginProfileSchema = z.object({
  name: z.string().optional(),
  os: GoLoginOsSchema.optional(),
  navigator: GoLoginNavigatorSchema.optional(),
});

const GOLOGIN_OS_MAP: Record<z.infer<typeof GoLoginOsSchema>, FingerprintInput['os']> = {
  win: 'windows',
  mac: 'macos',
  lin: 'linux',
};

function parseResolution(resolution: string | undefined): { width: number; height: number } | null {
  if (!resolution) return null;
  const match = /^(\d+)x(\d+)$/.exec(resolution.trim());
  if (!match) return null;
  return { width: Number(match[1]), height: Number(match[2]) };
}

/**
 * Parses one GoLogin profile export (a single JSON object, matching what
 * GoLogin's own API returns for/accepts as one profile — not an array) into
 * this project's own `ProfileExport` manifest shape, ready for the same
 * `createProfileFromManifest()` path a native export/import already uses.
 * Throws `CompetitorImportError` for input that doesn't look like a GoLogin
 * profile at all (wrong shape entirely) — a profile missing individual
 * optional fields is NOT an error, it just falls back to generated defaults
 * for those fields specifically.
 */
export function parseGoLoginProfile(raw: unknown, seed: string): ProfileExport {
  const result = GoLoginProfileSchema.safeParse(raw);
  if (!result.success) {
    throw new CompetitorImportError(`Not a recognizable GoLogin profile export: ${result.error.message}`);
  }
  const parsed = result.data;
  const os = parsed.os ? GOLOGIN_OS_MAP[parsed.os] : undefined;
  const resolution = parseResolution(parsed.navigator?.resolution);

  // The base bundle supplies every field this GoLogin export didn't confirm
  // (WebGL vendor/renderer, canvas/audio mode, timezone, geolocation, ...) —
  // see this module's own top comment for why those are never guessed.
  const base = generateFingerprint({ seed, os });

  const merged: FingerprintInput = {
    ...base,
    userAgent: parsed.navigator?.userAgent ?? base.userAgent,
    platform: parsed.navigator?.platform ?? base.platform,
    screenWidth: resolution?.width ?? base.screenWidth,
    screenHeight: resolution?.height ?? base.screenHeight,
    hardwareConcurrency: parsed.navigator?.hardwareConcurrency ?? base.hardwareConcurrency,
    deviceMemory: parsed.navigator?.deviceMemory ?? base.deviceMemory,
    maxTouchPoints: parsed.navigator?.maxTouchPoints ?? base.maxTouchPoints,
    // A bare language tag ("en-US") becomes both the locale and its own
    // one-entry languages list — GoLogin's export doesn't confirm a
    // separate accept-languages list the way this project's own does.
    locale: parsed.navigator?.language ?? base.locale,
    languages: parsed.navigator?.language ? [parsed.navigator.language] : base.languages,
  };

  // A malformed or internally-inconsistent source export (e.g. a UA that
  // doesn't actually mention the claimed OS) could otherwise produce a
  // fingerprint this project's own validator would reject — never shipped
  // silently. Falls all the way back to the fully-generated, already-
  // coherent `base` bundle rather than trying to guess which individual
  // field caused the conflict — same "don't half-fix an incoherent
  // combination" posture generator.ts's own override validation already
  // takes for foreign field overrides.
  const fingerprint = validateFingerprint(merged).errors.length === 0 ? merged : base;

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    mode: 'config',
    profile: {
      name: parsed.name ?? `gologin-import-${seed.slice(0, 8)}`,
      description: 'Imported from a GoLogin profile export',
      tags: ['imported-gologin'],
    },
    fingerprint,
    proxy: null, // GoLogin's confirmed navigator shape carries no proxy fields — see this module's top comment.
    metadata: { exportedAt: new Date().toISOString(), sourceAppVersion: 'gologin-import' },
  };
}
