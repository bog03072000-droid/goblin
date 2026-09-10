import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

/**
 * Real edge case from this round's list: "editing the same profile in two
 * open editor windows". The manager app has no `requestSingleInstanceLock()`
 * anywhere (confirmed by grep across src/main) — nothing stops a user from
 * launching a second instance pointed at the same --user-data-dir (a double
 * click on the app icon is enough), each with its own SQLite connection to
 * the SAME on-disk file. db.ts turns on WAL mode specifically because it
 * supports exactly this: multiple real OS processes reading/writing the
 * same file concurrently.
 *
 * `ProfileRepository.update()` used to read `existing = this.getById(id)`
 * BEFORE opening any transaction, merge the caller's partial patch on top
 * of that snapshot in plain JS, then write the WHOLE merged row back. If a
 * second connection's own such read happened in the gap before a FIRST
 * connection's write committed, the second connection's later write would
 * silently revert whatever the first one just committed, even for a column
 * the second caller never intended to touch — a classic TOCTOU lost-update.
 *
 * A genuine reproduction needs the second connection's internal read to
 * land in that gap — true OS-level concurrency, which two sequential calls
 * in one test process can never produce (each call's own fresh read always
 * sees every prior commit). Proven the honest way here: `getById()` is the
 * one specific internal call whose *timing* the race depends on, so it's
 * temporarily mocked to return a snapshot captured BEFORE the other
 * connection's commit — simulating exactly what a genuinely concurrent
 * read would have seen — while everything else (the merge logic, the SQL
 * actually executed) is the real, current `update()` code, unmodified.
 */
function openConnection(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function runMigrationsOnce(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.prepare('SELECT name FROM _migrations').all().map((r) => (r as { name: string }).name));
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
  }
}

describe('ProfileRepository.update() cross-connection safety (two app instances sharing one DB file)', () => {
  let tmpDir: string;
  let dbPath: string;
  let dbA: Database.Database;
  let dbB: Database.Database;
  let repoA: ProfileRepository;
  let repoB: ProfileRepository;
  let profileId: string;
  let proxyId: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-update-race-'));
    dbPath = path.join(tmpDir, 'profileforge.db');
    dbA = openConnection(dbPath);
    runMigrationsOnce(dbA);
    dbB = openConnection(dbPath);

    repoA = new ProfileRepository(dbA);
    repoB = new ProfileRepository(dbB);
    const fingerprintsA = new FingerprintRepository(dbA);
    const proxiesA = new ProxyRepository(dbA);
    const fp = fingerprintsA.create(generateFingerprint({ seed: 'race-test' }));
    const profile = repoA.create({ name: 'Original', profilePath: '/tmp/race-test', fingerprintId: fp.id, proxyId: null });
    profileId = profile.id;
    proxyId = proxiesA.create({ name: 'Race Proxy', protocol: 'http', host: '127.0.0.1', port: 8080 }).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dbA.close();
    dbB.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a stale read on connection B (simulating one that predates connection A's commit), followed by B saving only an UNRELATED field, does not revert A's real change", () => {
    // The pre-commit snapshot a genuinely concurrent read on B would have
    // seen — proxyId still null.
    const staleSnapshot = repoB.getById(profileId)!;
    expect(staleSnapshot.proxyId).toBeNull();

    // Connection A's own update() runs to completion — a real, committed
    // change to a field B never touches, exactly like a second window
    // saving the Proxy tab while this window still shows the General tab's
    // stale pre-save snapshot.
    repoA.update(profileId, { proxyId });
    expect(repoA.getById(profileId)!.proxyId).toBe(proxyId);

    // Force B's OWN internal getById() (called inside update() for the
    // not-found check) to return the stale pre-commit snapshot, simulating
    // a read that genuinely landed before A's commit — the exact condition
    // the old code was vulnerable to. Everything else about update() runs
    // for real.
    vi.spyOn(repoB, 'getById').mockReturnValue(staleSnapshot);
    repoB.update(profileId, { name: 'Renamed by B' });
    vi.restoreAllMocks();

    const final = repoA.getById(profileId)!;
    expect(final.name).toBe('Renamed by B');
    // The real, current update() never puts proxy_id in its SQL at all
    // unless the caller's own patch includes it — so A's change survives
    // regardless of how stale B's own read was.
    expect(final.proxyId).toBe(proxyId);
  });

  it('two connections updating the SAME field concurrently still resolve last-write-wins — expected, not a bug this fix addresses', () => {
    repoA.update(profileId, { name: 'From A' });
    repoB.update(profileId, { name: 'From B' });
    expect(repoA.getById(profileId)!.name).toBe('From B');
  });
});
