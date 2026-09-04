import { app, safeStorage } from 'electron';
import crypto from 'node:crypto';
import os from 'node:os';

/**
 * Wraps Electron's safeStorage (DPAPI on Windows / Keychain on macOS / Secret
 * Service on Linux) so proxy passwords are never written to SQLite in
 * plaintext. When OS-level encryption is unavailable (e.g. some CI/headless
 * environments, or a Linux machine with no Secret Service running), this
 * used to fall back to a clearly-marked but genuinely unencrypted plaintext
 * format — real protection only in the common case. It now falls back to a
 * self-managed AES-256-GCM layer instead, keyed from a passphrase derived
 * from stable, local machine/OS identifiers (see `deriveFallbackKey()` below
 * and SECURITY.md's "Credential storage" section for the full honest
 * writeup of what this does and doesn't protect against — it is real
 * encryption, not obfuscation, but it is meaningfully weaker than the OS
 * keychain: the "secret" is derivable by anything with local code execution
 * on the same machine/user account, so it stops casual DB-file inspection
 * and naive cross-machine exfiltration, not a determined local attacker.
 *
 * Both the legacy plaintext marker (read-only, for rows written before this
 * change) and the new AES-GCM marker are distinguished by a prefix on the
 * stored buffer, so `decryptSecret` can tell all three formats apart
 * (safeStorage's own buffers carry their own `v10`/`v11`-style prefix and
 * never start with either of these ASCII markers).
 */
const LEGACY_PLAINTEXT_PREFIX = 'PLAINTEXT:';
const FALLBACK_AESGCM_PREFIX = 'AESGCM1:';
const FALLBACK_AESGCM_PREFIX_BYTES = Buffer.from(FALLBACK_AESGCM_PREFIX, 'utf-8');
const GCM_IV_LENGTH = 12;
const GCM_AUTH_TAG_LENGTH = 16;
// Not a secret by itself — scrypt's salt exists to stop rainbow-table reuse
// across different passphrases, not to add entropy on its own. The actual
// diversity comes from the machine-derived passphrase in deriveFallbackKey();
// a fixed, app-specific salt is an accepted simplification for this threat
// model (see the module doc comment above).
const SCRYPT_SALT = 'goblinanty-credential-vault-fallback-v1';

let cachedFallbackKey: Buffer | null = null;

/** A passphrase derived from stable local identifiers — hostname, OS
 * platform/arch, the OS username, and this app's own per-user data
 * directory — rather than a hardcoded or empty value. Deliberately not a
 * hardware ID or anything requiring a native dependency: every input here
 * is already available through Node's own `os` module or Electron's `app`,
 * keeping this fallback dependency-free. `os.userInfo()` can throw in some
 * restricted/sandboxed environments (rare) — caught and treated as an
 * empty contribution rather than crashing credential storage entirely. */
function deriveFallbackKey(): Buffer {
  if (cachedFallbackKey) return cachedFallbackKey;
  let username = '';
  try {
    username = os.userInfo().username;
  } catch {
    /* some restricted/sandboxed environments throw here — fall through with an empty contribution */
  }
  const machineId = [os.hostname(), os.platform(), os.arch(), username, app.getPath('userData')].join('|');
  cachedFallbackKey = crypto.scryptSync(machineId, SCRYPT_SALT, 32);
  return cachedFallbackKey;
}

function encryptFallback(plainText: string): Buffer {
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveFallbackKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([FALLBACK_AESGCM_PREFIX_BYTES, iv, authTag, ciphertext]);
}

function decryptFallback(data: Buffer): string {
  const body = data.subarray(FALLBACK_AESGCM_PREFIX_BYTES.length);
  const iv = body.subarray(0, GCM_IV_LENGTH);
  const authTag = body.subarray(GCM_IV_LENGTH, GCM_IV_LENGTH + GCM_AUTH_TAG_LENGTH);
  const ciphertext = body.subarray(GCM_IV_LENGTH + GCM_AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveFallbackKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
}

export function encryptSecret(plainText: string): Buffer {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(plainText);
  }
  return encryptFallback(plainText);
}

export function decryptSecret(data: Buffer): string {
  if (data.subarray(0, FALLBACK_AESGCM_PREFIX_BYTES.length).equals(FALLBACK_AESGCM_PREFIX_BYTES)) {
    return decryptFallback(data);
  }
  const asText = data.toString('utf-8');
  if (asText.startsWith(LEGACY_PLAINTEXT_PREFIX)) {
    return asText.slice(LEGACY_PLAINTEXT_PREFIX.length);
  }
  return safeStorage.decryptString(data);
}
