import type { TranslationKey } from '../i18n';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

// Ordered by specificity — matched top to bottom against the raw Error
// message that crossed the IPC boundary. A Zod validation failure serializes
// as a JSON array (starts with "["), which is why that check comes last as
// a catch-all for "the input itself was rejected" rather than a specific
// business rule.
const PATTERNS: Array<[RegExp, TranslationKey]> = [
  [/^Profile is already running/, 'errors.profileAlreadyRunning'],
  [/^Profile is locked by another running instance/, 'errors.profileLocked'],
  [/^Stop the profile before/, 'errors.stopProfileFirst'],
  [/^Profile fingerprint is missing/, 'errors.fingerprintMissing'],
  [/^Source fingerprint missing/, 'errors.fingerprintMissing'],
  [/^Profile not found/, 'errors.profileNotFound'],
  [/^Proxy not found/, 'errors.proxyNotFound'],
  [/^\[/, 'errors.invalidInput'],
];

/** Maps a raw error (an IPC rejection message, or anything else thrown in the
 * renderer) to a short, actionable, localized phrase for display in a
 * banner. The original error is always logged to the console untouched, so
 * the technical detail is still one DevTools open away for debugging. */
export function describeError(err: unknown, t: Translate): string {
  const raw = err instanceof Error ? err.message : String(err);
  console.error(raw, err);
  for (const [pattern, key] of PATTERNS) {
    if (pattern.test(raw)) return t(key);
  }
  return t('common.unexpectedError');
}
