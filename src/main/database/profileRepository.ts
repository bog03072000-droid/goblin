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
      conditions.push('p.name LIKE ?');
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
    }>,
  ): Profile {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Profile not found: ${id}`);
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE profiles SET name=@name, description=@description, proxy_id=@proxyId, group_id=@groupId,
           automation_enabled=@automationEnabled, automation_port=@automationPort, updated_at=@updatedAt WHERE id=@id`,
        )
        .run({
          id,
          name: patch.name ?? existing.name,
          description: patch.description ?? existing.description,
          proxyId: patch.proxyId !== undefined ? patch.proxyId : existing.proxyId,
          groupId: patch.groupId !== undefined ? patch.groupId : existing.groupId,
          automationEnabled: (patch.automationEnabled ?? existing.automationEnabled) ? 1 : 0,
          automationPort: patch.automationPort !== undefined ? patch.automationPort : existing.automationPort,
          updatedAt: new Date().toISOString(),
        });
      if (patch.tags) this.setTags(id, patch.tags);
    });
    update();
    return this.getById(id)!;
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
