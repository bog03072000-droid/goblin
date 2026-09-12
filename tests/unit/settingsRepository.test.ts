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

  it('persists an explicit theme choice, defaulting to "system" when never set', () => {
    expect(repo.getAll().theme).toBe('system');
    const updated = repo.update({ theme: 'light' });
    expect(updated.theme).toBe('light');
    expect(repo.getAll().theme).toBe('light');
  });

  it('does not let a corrupted individual key break reading the rest', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('cacheLimitMb', '{not-json');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('autoCacheCleanup', 'true');
    const settings = repo.getAll();
    expect(settings.autoCacheCleanup).toBe(true);
    expect(settings.cacheLimitMb).toBe(DEFAULT_SETTINGS.cacheLimitMb);
  });

  it('restApiEnabled/restApiPort default to off/null and round-trip through update()', () => {
    expect(repo.getAll().restApiEnabled).toBe(false);
    expect(repo.getAll().restApiPort).toBeNull();
    const updated = repo.update({ restApiEnabled: true, restApiPort: 5900 });
    expect(updated.restApiEnabled).toBe(true);
    expect(updated.restApiPort).toBe(5900);
  });

  it('getRestApiToken returns null before any token has been generated', () => {
    expect(repo.getRestApiToken()).toBeNull();
  });

  it('regenerateRestApiToken stores a real, retrievable token, never in plaintext in the raw table', () => {
    const token = repo.regenerateRestApiToken();
    expect(token).toHaveLength(72);
    expect(repo.getRestApiToken()).toBe(token);

    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('restApiTokenEncrypted') as { value: string };
    expect(row.value).not.toContain(token);
  });

  it('regenerating invalidates the previous token', () => {
    const first = repo.regenerateRestApiToken();
    const second = repo.regenerateRestApiToken();
    expect(second).not.toBe(first);
    expect(repo.getRestApiToken()).toBe(second);
  });

  it('the REST API token is never part of getAll()\'s Settings result', () => {
    repo.regenerateRestApiToken();
    const settings = repo.getAll() as Record<string, unknown>;
    expect(settings['restApiToken']).toBeUndefined();
    expect(settings['restApiTokenEncrypted']).toBeUndefined();
  });
});
