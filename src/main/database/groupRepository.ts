import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { Group } from '../../shared/schemas/group';

interface GroupRow {
  id: string;
  name: string;
  created_at: string;
  profile_count: number;
}

/** Groups/folders coexist with tags — a profile has at most one group but any
 * number of tags. Deleting a group sets group_id to NULL on its profiles
 * (ON DELETE SET NULL in the migration) rather than deleting the profiles. */
export class GroupRepository {
  constructor(private readonly db: Database.Database) {}

  private rowToGroup(row: GroupRow): Group {
    return { id: row.id, name: row.name, createdAt: row.created_at, profileCount: row.profile_count };
  }

  list(): Group[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.name, g.created_at,
                (SELECT COUNT(*) FROM profiles p WHERE p.group_id = g.id) AS profile_count
         FROM groups g ORDER BY g.name`,
      )
      .all() as GroupRow[];
    return rows.map((r) => this.rowToGroup(r));
  }

  getById(id: string): Group | null {
    const row = this.db
      .prepare(
        `SELECT g.id, g.name, g.created_at,
                (SELECT COUNT(*) FROM profiles p WHERE p.group_id = g.id) AS profile_count
         FROM groups g WHERE g.id = ?`,
      )
      .get(id) as GroupRow | undefined;
    return row ? this.rowToGroup(row) : null;
  }

  create(name: string): Group {
    const existing = this.db.prepare('SELECT id FROM groups WHERE name = ?').get(name);
    if (existing) throw new Error(`A group named "${name}" already exists`);
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)')
      .run(id, name, new Date().toISOString());
    return this.getById(id)!;
  }

  rename(id: string, name: string): Group {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Group not found: ${id}`);
    const collision = this.db.prepare('SELECT id FROM groups WHERE name = ? AND id != ?').get(name, id);
    if (collision) throw new Error(`A group named "${name}" already exists`);
    this.db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, id);
    return this.getById(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  }

  /** Ordered proxy ids in this group's rotation pool — used by
   * ProfileManager.start() when a profile has no proxy of its own assigned
   * (see pickNextPoolProxy()). Empty means no pool configured; profiles in
   * that group with no direct proxy assignment simply run unproxied, same
   * as today. */
  getProxyPool(groupId: string): string[] {
    const rows = this.db
      .prepare('SELECT proxy_id FROM group_proxy_pool WHERE group_id = ? ORDER BY position')
      .all(groupId) as Array<{ proxy_id: string }>;
    return rows.map((r) => r.proxy_id);
  }

  /** Replaces the whole pool in one transaction — the renderer always sends
   * the complete desired list (a multi-select), never a delta. */
  setProxyPool(groupId: string, proxyIds: string[]): void {
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM group_proxy_pool WHERE group_id = ?').run(groupId);
      const insert = this.db.prepare(
        'INSERT INTO group_proxy_pool (group_id, proxy_id, position) VALUES (?, ?, ?)',
      );
      proxyIds.forEach((proxyId, i) => insert.run(groupId, proxyId, i));
    });
    tx();
  }

  /** Advances and returns this group's rotation cursor (0-based, wraps at
   * `poolSize`) — one DB round-trip does both, so two profiles in the same
   * group starting back-to-back never get handed the same cursor value. */
  private advanceRotationCursor(groupId: string, poolSize: number): number {
    const row = this.db.prepare('SELECT proxy_rotation_cursor FROM groups WHERE id = ?').get(groupId) as
      | { proxy_rotation_cursor: number }
      | undefined;
    const current = row?.proxy_rotation_cursor ?? 0;
    const next = (current + 1) % poolSize;
    this.db.prepare('UPDATE groups SET proxy_rotation_cursor = ? WHERE id = ?').run(next, groupId);
    return current % poolSize;
  }

  /** Round-robin: each call hands out the next proxy id in the group's pool,
   * wrapping around. Returns null if the group has no pool configured. */
  pickNextPoolProxy(groupId: string): string | null {
    const pool = this.getProxyPool(groupId);
    if (pool.length === 0) return null;
    const index = this.advanceRotationCursor(groupId, pool.length);
    return pool[index]!;
  }
}
