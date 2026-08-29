import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

let instance: Database.Database | null = null;

/** Applies any migration files in database/migrations not yet recorded in _migrations. */
function runMigrations(db: Database.Database, migrationsDir: string): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name),
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
    });
    apply();
  }
}

export function getDb(dbPath: string, migrationsDir: string): Database.Database {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrationsDir);
  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** Test-only: create an isolated in-memory database with migrations applied. */
export function createTestDb(migrationsDir: string): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db, migrationsDir);
  return db;
}
