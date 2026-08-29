import { describe, it, expect, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { TemplateRepository } from '../../src/main/database/templateRepository';

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('TemplateRepository', () => {
  let db: Database.Database;
  let repo: TemplateRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    repo = new TemplateRepository(db);
  });

  it('seeds the 6 built-in templates named in the brief', () => {
    repo.seedBuiltins();
    const names = repo.list().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Windows Desktop',
        'Windows Germany',
        'Windows France',
        'Windows Ukraine',
        'macOS Desktop',
        'Linux Desktop',
      ]),
    );
    expect(repo.list().length).toBe(6);
  });

  it('is idempotent — seeding twice does not duplicate', () => {
    repo.seedBuiltins();
    repo.seedBuiltins();
    expect(repo.list().length).toBe(6);
  });

  it('each template has a coherent os/locale definition', () => {
    repo.seedBuiltins();
    const germany = repo.getById('windows-germany');
    expect(germany?.definition).toEqual({ os: 'windows', locale: 'de-DE' });
    const mac = repo.getById('macos-desktop');
    expect(mac?.definition).toEqual({ os: 'macos' });
  });
});
