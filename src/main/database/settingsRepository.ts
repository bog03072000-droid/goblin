import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { SettingsSchema, DEFAULT_SETTINGS, type Settings, type SettingsUpdate } from '../../shared/schemas/settings';
import { encryptSecret, decryptSecret } from '../security/credentialVault';

// Stored under this raw key in the same generic (key, value TEXT) settings
// table `getAll()`/`update()` use — deliberately NOT part of SettingsSchema,
// same reasoning as a profile's automation_token_encrypted column never
// being part of the plain Profile object: getAll() would otherwise ship the
// (harmlessly encrypted, but still unnecessary) blob to the renderer on
// every settings:get call. The table has no dedicated BLOB column the way
// `profiles`/`proxies` do, so the encrypted Buffer is base64-encoded into
// the same TEXT value column everything else here already uses.
const REST_API_TOKEN_KEY = 'restApiTokenEncrypted';

/** Settings not present in the table fall back to DEFAULT_SETTINGS — the app
 * never crashes on a missing key, and adding a new setting doesn't need a migration. */
export class SettingsRepository {
  constructor(private readonly db: Database.Database) {}

  getAll(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{
      key: string;
      value: string;
    }>;
    const stored: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        stored[row.key] = JSON.parse(row.value);
      } catch {
        // Ignore a corrupted individual key rather than failing all settings.
      }
    }
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    return SettingsSchema.parse(merged);
  }

  update(patch: SettingsUpdate): Settings {
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value',
    );
    const apply = this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        upsert.run({ key, value: JSON.stringify(value) });
      }
    });
    apply();
    return this.getAll();
  }

  /** Never part of getAll()'s Settings result (see REST_API_TOKEN_KEY's own
   * comment) — only this dedicated method decrypts and returns it, for the
   * Settings page's "copy token" action and for restApiServer.ts to check
   * incoming requests against. Returns null if the REST API was never
   * enabled (no token generated yet). */
  getRestApiToken(): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(REST_API_TOKEN_KEY) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return decryptSecret(Buffer.from(JSON.parse(row.value) as string, 'base64'));
    } catch {
      return null;
    }
  }

  /** Generates and stores a fresh token, invalidating any previous one —
   * used both the first time the REST API is enabled and for an explicit
   * "Regenerate token" action (e.g. if a token may have leaked). Same
   * generation shape as ProfileRepository.regenerateAutomationToken(). */
  regenerateRestApiToken(): string {
    const token = randomUUID() + randomUUID(); // 72 hex chars, not guessable
    const encryptedBase64 = encryptSecret(token).toString('base64');
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (@key, @value) ON CONFLICT(key) DO UPDATE SET value = @value')
      .run({ key: REST_API_TOKEN_KEY, value: JSON.stringify(encryptedBase64) });
    return token;
  }
}
