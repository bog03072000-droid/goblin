import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Profile, ProfileListItem, ProfileStatus } from '../../shared/schemas/profile';
import { encryptSecret, decryptSecret } from '../security/credentialVault';

interface ProfileRow {
  id: string;
  name: string;
  description: string;
  profile_path: string;
  fingerprint_id: string;
  proxy_id: string | null;
  group_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_started_at: string | null;
  last_stopped_at: string | null;
  deleted_at: string | null;
  automation_enabled: number;
  automation_port: number | null;
  automation_token_encrypted: Buffer | null;
  schedule_enabled: number;
  schedule_time: string | null;
  schedule_days: string | null;
  schedule_last_triggered_at: string | null;
}

interface ProfileListRow extends ProfileRow {
  os: string;
  browser_version: string;
}

export class ProfileRepository {
  constructor(private readonly db: Database.Database) {}

  private getTags(profileId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT t.name FROM tags t
         JOIN profile_tags pt ON pt.tag_id = t.id
         WHERE pt.profile_id = ? ORDER BY t.name`,
      )
      .all(profileId) as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  private setTags(profileId: string, tags: string[]): void {
    this.db.prepare('DELETE FROM profile_tags WHERE profile_id = ?').run(profileId);
    const insertTag = this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getTagId = this.db.prepare('SELECT id FROM tags WHERE name = ?');
    const link = this.db.prepare('INSERT OR IGNORE INTO profile_tags (profile_id, tag_id) VALUES (?, ?)');
    for (const tag of tags) {
      insertTag.run(tag);
      const row = getTagId.get(tag) as { id: number };
      link.run(profileId, row.id);
    }
  }

  /** Same TOCTOU class this round's `update()` fix addressed, but for the
   * `profile_tags` join table specifically: `update()`'s dynamic SET clause
   * only protects columns on the `profiles` row itself — `setTags()` above
   * still does a full DELETE-then-reinsert of the *entire* tag list, so a
   * caller that reads the current tags, adds/removes one in JS, and calls
   * `update({ tags: merged })` (exactly what `bulkAddTags`/`bulkRemoveTags`
   * in profileManager.ts used to do) can silently revert a concurrent
   * writer's own tag change from the same read-modify-write gap. These two
   * methods do the add/remove directly in SQL instead, with no read of the
   * current tag list at all — nothing to go stale, so nothing to revert. */
  addTags(profileId: string, tags: string[]): void {
    const insertTag = this.db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
    const getTagId = this.db.prepare('SELECT id FROM tags WHERE name = ?');
    const link = this.db.prepare('INSERT OR IGNORE INTO profile_tags (profile_id, tag_id) VALUES (?, ?)');
    const run = this.db.transaction((names: string[]) => {
      for (const tag of names) {
        insertTag.run(tag);
        const row = getTagId.get(tag) as { id: number };
        link.run(profileId, row.id);
      }
    });
    run(tags);
  }

  removeTags(profileId: string, tags: string[]): void {
    if (tags.length === 0) return;
    const placeholders = tags.map(() => '?').join(', ');
    this.db
      .prepare(
        `DELETE FROM profile_tags WHERE profile_id = ? AND tag_id IN
         (SELECT id FROM tags WHERE name IN (${placeholders}))`,
      )
      .run(profileId, ...tags);
  }

  private rowToProfile(row: ProfileRow): Profile {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      profilePath: row.profile_path,
      fingerprintId: row.fingerprint_id,
      proxyId: row.proxy_id,
      groupId: row.group_id,
      status: row.status as ProfileStatus,
      tags: this.getTags(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastStartedAt: row.last_started_at,
      lastStoppedAt: row.last_stopped_at,
      automationEnabled: Boolean(row.automation_enabled),
      automationPort: row.automation_port,
      scheduleEnabled: Boolean(row.schedule_enabled),
      scheduleTime: row.schedule_time,
      scheduleDays: row.schedule_days ? (JSON.parse(row.schedule_days) as number[]) : null,
      scheduleLastTriggeredAt: row.schedule_last_triggered_at,
    };
  }

  create(params: {
    name: string;
    description?: string;
    profilePath: string;
    fingerprintId: string;
    proxyId: string | null;
    groupId?: string | null;
    tags?: string[];
  }): Profile {
    const id = randomUUID();
    const now = new Date().toISOString();
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO profiles (id, name, description, profile_path, fingerprint_id, proxy_id, group_id, status, created_at, updated_at, last_started_at, last_stopped_at)
           VALUES (@id, @name, @description, @profilePath, @fingerprintId, @proxyId, @groupId, 'STOPPED', @now, @now, NULL, NULL)`,
        )
        .run({
          id,
          name: params.name,
          description: params.description ?? '',
          profilePath: params.profilePath,
          fingerprintId: params.fingerprintId,
          proxyId: params.proxyId,
          groupId: params.groupId ?? null,
          now,
        });
      if (params.tags?.length) this.setTags(id, params.tags);
    });
    create();
    return this.getById(id)!;
  }

  getById(id: string): Profile | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as ProfileRow | undefined;
    return row ? this.rowToProfile(row) : null;
  }

  /** Includes OS/browser version via a single SQL join — not a per-profile
   * fingerprint lookup — so this stays fast at 200 stored profiles (see
   * tests/performance/profileScale.test.ts). Soft-deleted profiles (deleted_at
   * set — see softDelete()) are excluded by default; pass includeDeleted to
   * see them (used only by the startup purge of stale soft-deletes). */
  list(filter?: { search?: string; tag?: string; groupId?: string; includeDeleted?: boolean }): ProfileListItem[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let joins = 'JOIN fingerprints f ON f.id = p.fingerprint_id';

    if (!filter?.includeDeleted) {
      conditions.push('p.deleted_at IS NULL');
    }
    if (filter?.tag) {
      joins += ' JOIN profile_tags pt ON pt.profile_id = p.id JOIN tags t ON t.id = pt.tag_id';
      conditions.push('t.name = ?');
      params.push(filter.tag);
    }
    if (filter?.search) {
      // lower_unicode (db.ts) — plain LIKE is only case-insensitive for
      // ASCII, silently missing a lowercase Cyrillic search against a
      // capitalized stored profile name (or vice versa).
      conditions.push('lower_unicode(p.name) LIKE lower_unicode(?)');
      params.push(`%${filter.search}%`);
    }
    if (filter?.groupId) {
      conditions.push('p.group_id = ?');
      params.push(filter.groupId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.db
      .prepare(
        `SELECT p.*, f.os AS os, f.browser_version AS browser_version FROM profiles p
         ${joins}
         ${where}
         ORDER BY p.updated_at DESC`,
      )
      .all(...params) as ProfileListRow[];
    return rows.map((r) => ({ ...this.rowToProfile(r), os: r.os, browserVersion: r.browser_version }));
  }

  /** A real cross-connection race this round found: nothing (there's no
   * `requestSingleInstanceLock()` anywhere in this app) stops a user from
   * running two instances against the same --user-data-dir, each with its
   * own SQLite connection to the same on-disk file (db.ts turns on WAL mode
   * specifically because it supports this). The previous implementation
   * read the FULL current row once (`existing`), merged the caller's patch
   * over it in plain JS, and wrote the WHOLE merged row back — so if a
   * second connection's own read-modify-write cycle landed in the gap
   * between this read and this write's commit, the second write would
   * silently revert whatever the first one just committed, even for a
   * column the second caller never intended to touch (e.g. the Proxy tab
   * saving in one window while the General tab saves in another — a
   * classic TOCTOU lost-update). Reproduced deterministically in
   * tests/unit/profileRepositoryUpdateRace.test.ts against two real
   * on-disk connections before this fix.
   *
   * Fixed structurally, not just by serializing the race: the UPDATE's own
   * SET clause is built dynamically from only the columns actually present
   * in `patch`, so a column this call didn't intend to change is never
   * part of the SQL statement at all — no "existing" read/merge is needed
   * for it, and it genuinely cannot be reverted by this call regardless of
   * timing. (Two callers changing the SAME column concurrently still
   * resolve last-write-wins, which is expected and unavoidable for a
   * plain form editor — that is not what this fix addresses.) */
  update(
    id: string,
    patch: Partial<{
      name: string;
      description: string;
      proxyId: string | null;
      groupId: string | null;
      tags: string[];
      automationEnabled: boolean;
      automationPort: number | null;
      scheduleEnabled: boolean;
      scheduleTime: string | null;
      scheduleDays: number[] | null;
    }>,
  ): Profile {
    const columns: Record<string, unknown> = {};
    if (patch.name !== undefined) columns['name'] = patch.name;
    if (patch.description !== undefined) columns['description'] = patch.description;
    if (patch.proxyId !== undefined) columns['proxy_id'] = patch.proxyId;
    if (patch.groupId !== undefined) columns['group_id'] = patch.groupId;
    if (patch.automationEnabled !== undefined) columns['automation_enabled'] = patch.automationEnabled ? 1 : 0;
    if (patch.automationPort !== undefined) columns['automation_port'] = patch.automationPort;
    if (patch.scheduleEnabled !== undefined) columns['schedule_enabled'] = patch.scheduleEnabled ? 1 : 0;
    if (patch.scheduleTime !== undefined) columns['schedule_time'] = patch.scheduleTime;
    if (patch.scheduleDays !== undefined) columns['schedule_days'] = JSON.stringify(patch.scheduleDays);
    columns['updated_at'] = new Date().toISOString();

    const update = this.db.transaction(() => {
      if (!this.getById(id)) throw new Error(`Profile not found: ${id}`);
      const setClause = Object.keys(columns)
        .map((col) => `${col}=@${col}`)
        .join(', ');
      this.db.prepare(`UPDATE profiles SET ${setClause} WHERE id=@id`).run({ ...columns, id });
      if (patch.tags) this.setTags(id, patch.tags);
    });
    update();
    return this.getById(id)!;
  }

  /** Profiles with a recurring schedule turned on — used by ProfileScheduler's
   * own polling loop rather than filtering the full list() client-side, since
   * this runs on every tick and most profiles won't have scheduling enabled. */
  listScheduled(): Profile[] {
    const rows = this.db.prepare('SELECT * FROM profiles WHERE schedule_enabled = 1 AND deleted_at IS NULL').all() as ProfileRow[];
    return rows.map((r) => this.rowToProfile(r));
  }

  /** Records that this profile's schedule fired just now — see
   * ProfileScheduler's own comment on why this exists (prevents firing twice
   * for the same matching minute across consecutive polls). */
  recordScheduleTriggered(id: string, whenIso: string): void {
    this.db.prepare('UPDATE profiles SET schedule_last_triggered_at = ? WHERE id = ?').run(whenIso, id);
  }

  /** The automation token is never part of the plain Profile object returned
   * by getById()/list() (same posture as a proxy's password) — only this
   * dedicated method decrypts and returns it, for the Advanced tab's
   * "copy token" action and for ProfileManager to hand to the child process
   * on start(). Returns null if automation was never enabled for this
   * profile (no token generated yet). */
  getAutomationToken(id: string): string | null {
    const row = this.db.prepare('SELECT automation_token_encrypted FROM profiles WHERE id = ?').get(id) as
      | { automation_token_encrypted: Buffer | null }
      | undefined;
    if (!row?.automation_token_encrypted) return null;
    return decryptSecret(row.automation_token_encrypted);
  }

  /** Generates and stores a fresh token, invalidating any previous one —
   * used both the first time automation is enabled and for an explicit
   * "Regenerate token" action (e.g. if a token may have leaked). */
  regenerateAutomationToken(id: string): string {
    const token = randomUUID() + randomUUID(); // 72 hex chars, not guessable
    const encrypted = encryptSecret(token);
    this.db
      .prepare('UPDATE profiles SET automation_token_encrypted = ?, updated_at = ? WHERE id = ?')
      .run(encrypted, new Date().toISOString(), id);
    return token;
  }

  /** Internal invariant setter — profile_path is computed by ProfileManager from a
   * freshly generated ID and is never part of the public update() surface exposed to IPC. */
  setProfilePath(id: string, profilePath: string): void {
    this.db
      .prepare('UPDATE profiles SET profile_path = ?, updated_at = ? WHERE id = ?')
      .run(profilePath, new Date().toISOString(), id);
  }

  updateStatus(id: string, status: ProfileStatus): void {
    const now = new Date().toISOString();
    if (status === 'RUNNING') {
      this.db
        .prepare('UPDATE profiles SET status=?, last_started_at=?, updated_at=? WHERE id=?')
        .run(status, now, now, id);
    } else if (status === 'STOPPED') {
      this.db
        .prepare('UPDATE profiles SET status=?, last_stopped_at=?, updated_at=? WHERE id=?')
        .run(status, now, now, id);
    } else {
      this.db.prepare('UPDATE profiles SET status=?, updated_at=? WHERE id=?').run(status, now, id);
    }
  }

  /** Marks a profile deleted without removing the row — ProfileManager.delete()
   * schedules the real (hard) removal after an undo window; see hardDelete(). */
  softDelete(id: string): void {
    this.db.prepare('UPDATE profiles SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }

  /** Reverses softDelete() — the profile reappears in list()'s default (non-
   * includeDeleted) results immediately. */
  restoreDeleted(id: string): void {
    this.db.prepare('UPDATE profiles SET deleted_at = NULL WHERE id = ?').run(id);
  }

  /** Actual, irreversible row removal — only ever called once a soft-deleted
   * profile's undo window has elapsed. */
  hardDelete(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  }

  /** Soft-deleted profiles whose undo window has already elapsed — used once
   * at startup to finish hard-deleting anything an in-memory ProfileManager
   * timer never got to fire for (app closed/crashed inside the undo window). */
  listStaleDeleted(cutoffIso: string): Array<{ id: string }> {
    return this.db.prepare('SELECT id FROM profiles WHERE deleted_at IS NOT NULL AND deleted_at <= ?').all(cutoffIso) as Array<{
      id: string;
    }>;
  }
}
