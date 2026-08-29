import type Database from 'better-sqlite3';
import { SettingsSchema, DEFAULT_SETTINGS, type Settings, type SettingsUpdate } from '../../shared/schemas/settings';

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
}
