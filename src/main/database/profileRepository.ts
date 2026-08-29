import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Profile, ProfileStatus } from '../../shared/schemas/profile';

interface ProfileRow {
  id: string;
  name: string;
  description: string;
  profile_path: string;
  fingerprint_id: string;
  proxy_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  last_started_at: string | null;
  last_stopped_at: string | null;
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
      status: row.status as ProfileStatus,
      tags: this.getTags(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastStartedAt: row.last_started_at,
      lastStoppedAt: row.last_stopped_at,
    };
  }

  create(params: {
    name: string;
    description?: string;
    profilePath: string;
    fingerprintId: string;
    proxyId: string | null;
    tags?: string[];
  }): Profile {
    const id = randomUUID();
    const now = new Date().toISOString();
    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO profiles (id, name, description, profile_path, fingerprint_id, proxy_id, status, created_at, updated_at, last_started_at, last_stopped_at)
           VALUES (@id, @name, @description, @profilePath, @fingerprintId, @proxyId, 'STOPPED', @now, @now, NULL, NULL)`,
        )
        .run({
          id,
          name: params.name,
          description: params.description ?? '',
          profilePath: params.profilePath,
          fingerprintId: params.fingerprintId,
          proxyId: params.proxyId,
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

  list(filter?: { search?: string; tag?: string }): Profile[] {
    let rows: ProfileRow[];
    if (filter?.tag) {
      rows = this.db
        .prepare(
          `SELECT p.* FROM profiles p
           JOIN profile_tags pt ON pt.profile_id = p.id
           JOIN tags t ON t.id = pt.tag_id
           WHERE t.name = ? ORDER BY p.updated_at DESC`,
        )
        .all(filter.tag) as ProfileRow[];
    } else if (filter?.search) {
      rows = this.db
        .prepare('SELECT * FROM profiles WHERE name LIKE ? ORDER BY updated_at DESC')
        .all(`%${filter.search}%`) as ProfileRow[];
    } else {
      rows = this.db.prepare('SELECT * FROM profiles ORDER BY updated_at DESC').all() as ProfileRow[];
    }
    return rows.map((r) => this.rowToProfile(r));
  }

  update(
    id: string,
    patch: Partial<{ name: string; description: string; proxyId: string | null; tags: string[] }>,
  ): Profile {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Profile not found: ${id}`);
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE profiles SET name=@name, description=@description, proxy_id=@proxyId, updated_at=@updatedAt WHERE id=@id`,
        )
        .run({
          id,
          name: patch.name ?? existing.name,
          description: patch.description ?? existing.description,
          proxyId: patch.proxyId !== undefined ? patch.proxyId : existing.proxyId,
          updatedAt: new Date().toISOString(),
        });
      if (patch.tags) this.setTags(id, patch.tags);
    });
    update();
    return this.getById(id)!;
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

  delete(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  }
}
