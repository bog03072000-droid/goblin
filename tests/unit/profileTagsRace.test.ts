import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { ProfileManager } from '../../src/main/profiles/profileManager';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

/**
 * Same TOCTOU class as profileRepositoryUpdateRace.test.ts (no
 * `requestSingleInstanceLock()` anywhere, so two real app instances can
 * share one on-disk DB file), applied to a corner that fix didn't reach:
 * bulkAddTags/bulkRemoveTags used to read a profile's CURRENT tag list,
 * merge the requested add/remove in plain JS, and write the whole merged
 * list back via setTags() (a full DELETE-then-reinsert of the join table).
 * A second connection's own tag change committing in the gap between that
 * read and that write would be silently reverted — even though it never
 * touched the same tag name.
 *
 * Fixed the same way profileRepository.update() was: remove the read
 * entirely rather than just serializing around it. addTags()/removeTags()
 * (profileRepository.ts) now do the add/remove directly in SQL with no
 * prior read of the current list — so there is no stale snapshot for a
 * second connection to revert, regardless of timing.
 *
 * Two real, sequential, unmocked calls from separate connections can't
 * actually reproduce the OLD bug either — each call's own fresh read
 * always observes every prior commit in a single-threaded test process
 * (the same lesson profileRepositoryUpdateRace.test.ts already learned
 * the hard way). So the one call whose *timing* the old bug depended on —
 * B's own `getById()`, called inside the old `bulkAddTags`'s `mustGet()`
 * to build its merge — is forced to return a stale, pre-commit snapshot
 * via `vi.spyOn`, simulating exactly what a genuinely concurrent read
 * would have seen. Everything else runs for real. Against the CURRENT
 * (fixed) code this mock is inert, since the new addTags()/removeTags()
 * never call getById() to begin with — which is itself part of the proof
 * that the fix removes the gap rather than just narrowing it.
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

describe('bulkAddTags/bulkRemoveTags cross-connection safety (two app instances sharing one DB file)', () => {
  let tmpDir: string;
  let dbPath: string;
  let dbA: Database.Database;
  let dbB: Database.Database;
  let rootA: string;
  let rootB: string;
  let managerA: ProfileManager;
  let managerB: ProfileManager;
  let profilesA: ProfileRepository;
  let profilesB: ProfileRepository;
  let profileId: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tags-race-'));
    dbPath = path.join(tmpDir, 'profileforge.db');
    dbA = openConnection(dbPath);
    runMigrationsOnce(dbA);
    dbB = openConnection(dbPath);

    rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tags-race-root-a-'));
    rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-tags-race-root-b-'));

    profilesA = new ProfileRepository(dbA);
    const fingerprintsA = new FingerprintRepository(dbA);
    const proxiesA = new ProxyRepository(dbA);
    const logsA = new ActivityLogRepository(dbA);
    managerA = new ProfileManager(rootA, profilesA, fingerprintsA, proxiesA, logsA, ':memory:');

    profilesB = new ProfileRepository(dbB);
    const fingerprintsB = new FingerprintRepository(dbB);
    const proxiesB = new ProxyRepository(dbB);
    const logsB = new ActivityLogRepository(dbB);
    managerB = new ProfileManager(rootB, profilesB, fingerprintsB, proxiesB, logsB, ':memory:');

    const fp = fingerprintsA.create(generateFingerprint({ seed: 'tags-race' }));
    profileId = managerA.create({ name: 'Tags Race', tags: ['base'] }, fp.id).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    dbA.close();
    dbB.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });

  it("a stale read on connection B (simulating one that predates connection A's commit), followed by B adding its own tag, does not revert A's real tag", async () => {
    // The pre-commit snapshot a genuinely concurrent read on B would have
    // seen — only 'base', before A's write below.
    const staleSnapshot = profilesB.getById(profileId)!;
    expect(staleSnapshot.tags).toEqual(['base']);

    // Connection A's own bulkAddTags runs to completion — a real, committed
    // change B never touches, exactly like a second window adding its own
    // tag right after this window's tag list finished saving.
    await managerA.bulkAddTags([profileId], ['from-a']);
    expect(profilesA.getById(profileId)!.tags.sort()).toEqual(['base', 'from-a']);

    // Force B's OWN internal getById() (called inside the old bulkAddTags's
    // mustGet(), used to build its merge) to return the stale pre-commit
    // snapshot — simulating a read that genuinely landed before A's commit.
    // Everything else about bulkAddTags/addTags runs for real.
    vi.spyOn(profilesB, 'getById').mockReturnValue(staleSnapshot);
    await managerB.bulkAddTags([profileId], ['from-b']);
    vi.restoreAllMocks();

    const final = profilesA.getById(profileId)!;
    // The current addTags() never reads the existing tag list at all, so
    // it can't merge from — let alone revert to — a stale snapshot,
    // regardless of how stale B's own read was.
    expect(final.tags.sort()).toEqual(['base', 'from-a', 'from-b']);
  });

  it("a stale read on connection B, followed by B removing an unrelated tag, does not revert A's real concurrently-added tag", async () => {
    const staleSnapshot = profilesB.getById(profileId)!;

    await managerA.bulkAddTags([profileId], ['keep-me']);
    expect(profilesA.getById(profileId)!.tags.sort()).toEqual(['base', 'keep-me']);

    vi.spyOn(profilesB, 'getById').mockReturnValue(staleSnapshot);
    await managerB.bulkRemoveTags([profileId], ['base']);
    vi.restoreAllMocks();

    const final = profilesA.getById(profileId)!;
    expect(final.tags.sort()).toEqual(['keep-me']);
  });
});
