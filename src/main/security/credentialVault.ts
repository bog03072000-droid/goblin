import { safeStorage } from 'electron';

/**
 * Wraps Electron's safeStorage (DPAPI on Windows) so proxy passwords are never
 * written to SQLite in plaintext. Falls back to a clearly-marked plaintext prefix
 * only when OS encryption is unavailable (e.g. some CI/headless environments),
 * so callers/tests can detect the degraded mode instead of silently trusting it.
 */
const PLAINTEXT_FALLBACK_PREFIX = 'PLAINTEXT:';

export function encryptSecret(plainText: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plainText);
  }
  return Buffer.from(PLAINTEXT_FALLBACK_PREFIX + plainText, 'utf-8');
}

export function decryptSecret(data: Buffer): string {
  const asText = data.toString('utf-8');
  if (asText.startsWith(PLAINTEXT_FALLBACK_PREFIX)) {
    return asText.slice(PLAINTEXT_FALLBACK_PREFIX.length);
  }
  return safeStorage.decryptString(data);
}
