import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { SettingsRepository } from '../../src/main/database/settingsRepository';
import { DEFAULT_SETTINGS } from '../../src/shared/schemas/settings';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('SettingsRepository', () => {
  let db: Database.Database;
  let repo: SettingsRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    repo = new SettingsRepository(db);
  });

  it('returns defaults when nothing has been stored', () => {
    expect(repo.getAll()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists a partial update and merges it with defaults', () => {
    const updated = repo.update({ hardwareAcceleration: false, cacheLimitMb: 500 });
    expect(updated.hardwareAcceleration).toBe(false);
    expect(updated.cacheLimitMb).toBe(500);
    expect(updated.startupBehavior).toBe(DEFAULT_SETTINGS.startupBehavior);

    // Re-fetch from a fresh call to confirm it was actually written, not just returned.
    expect(repo.getAll()).toEqual(updated);
  });

  it('does not let a corrupted individual key break reading the rest', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('cacheLimitMb', '{not-json');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('autoCacheCleanup', 'true');
    const settings = repo.getAll();
    expect(settings.autoCacheCleanup).toBe(true);
    expect(settings.cacheLimitMb).toBe(DEFAULT_SETTINGS.cacheLimitMb);
  });
});
