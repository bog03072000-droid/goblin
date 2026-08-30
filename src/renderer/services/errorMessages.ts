import type { TranslationKey } from '../i18n';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

// Ordered by specificity — matched top to bottom against the raw Error
// message that crossed the IPC boundary. Deliberately NOT anchored to the
// start of the string: Electron's ipcMain.handle wraps a thrown error's
// message with its own "Error invoking remote method '<channel>': Error: "
// prefix before it reaches the renderer, so an anchored /^Foo/ pattern would
// never match a real IPC rejection (only ever matched in tests that threw a
// plain Error directly, which is why this went undetected until a real
// end-to-end test — not a mocked one — exercised it). A Zod validation
// failure serializes its issues as a JSON array, which is why that check
// looks for a stringified-issue fragment rather than the array's own
// brackets (which would also be past the wrapper prefix).
const PATTERNS: Array<[RegExp, TranslationKey]> = [
  [/Profile is already running/, 'errors.profileAlreadyRunning'],
  [/Profile is locked by another running instance/, 'errors.profileLocked'],
  [/Stop the profile before/, 'errors.stopProfileFirst'],
  [/Profile fingerprint is missing/, 'errors.fingerprintMissing'],
  [/Source fingerprint missing/, 'errors.fingerprintMissing'],
  [/Profile not found/, 'errors.profileNotFound'],
  [/Proxy not found/, 'errors.proxyNotFound'],
  [/Download not found/, 'errors.downloadNotFound'],
  [/Profile storage directory is missing/, 'errors.profileStorageMissing'],
  [/Corrupted fingerprint data/, 'errors.corruptedProfileData'],
  [/ENOENT|Failed to launch|spawn .* ENOENT/, 'errors.launchFailed'],
  [/"code":\s*"/, 'errors.invalidInput'],
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
