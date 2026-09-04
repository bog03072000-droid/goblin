import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ProxyInput, ProxyRecord, ProxyCheckHistoryEntry } from '../../shared/schemas/proxy';
import { encryptSecret, decryptSecret } from '../security/credentialVault';

/** Cap on how many history rows one proxy keeps — trimmed on every insert
 * (see recordCheckResult()) rather than via a separate scheduled cleanup
 * job, so the table stays bounded with no extra moving parts. At the
 * scheduler's default 5-minute interval this is roughly 4h10m of history,
 * which is plenty for "did this proxy just start failing" without growing
 * unbounded over a long-running app session. */
const MAX_HISTORY_ROWS_PER_PROXY = 50;

interface ProxyCheckHistoryRow {
  id: string;
  status: string;
  latency_ms: number | null;
  checked_at: string;
}

function rowToHistoryEntry(row: ProxyCheckHistoryRow): ProxyCheckHistoryEntry {
  return {
    id: row.id,
    status: row.status as ProxyCheckHistoryEntry['status'],
    latencyMs: row.latency_ms,
    checkedAt: row.checked_at,
  };
}

interface ProxyRow {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  username: string | null;
  encrypted_password: Buffer | null;
  created_at: string;
  updated_at: string;
  last_check_status: string | null;
  last_checked_at: string | null;
  last_check_latency_ms: number | null;
}

function rowToProxy(row: ProxyRow): ProxyRecord {
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol as ProxyRecord['protocol'],
    host: row.host,
    port: row.port,
    username: row.username ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckStatus: row.last_check_status as ProxyRecord['lastCheckStatus'],
    lastCheckedAt: row.last_checked_at,
    lastCheckLatencyMs: row.last_check_latency_ms,
  };
}

/** Repository for proxy configs. Passwords are encrypted at rest via OS-level safeStorage
 * and are never returned by list()/getById() — only getPassword() can retrieve one, and
 * only for internal use (e.g. wiring up a session's proxy auth), never for logging/export. */
export class ProxyRepository {
  constructor(private readonly db: Database.Database) {}

  create(input: ProxyInput): ProxyRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    const encrypted = input.password ? encryptSecret(input.password) : null;
    this.db
      .prepare(
        `INSERT INTO proxies (id, name, protocol, host, port, username, encrypted_password, created_at, updated_at)
         VALUES (@id, @name, @protocol, @host, @port, @username, @encryptedPassword, @createdAt, @updatedAt)`,
      )
      .run({
        id,
        name: input.name,
        protocol: input.protocol,
        host: input.host,
        port: input.port,
        username: input.username ?? null,
        encryptedPassword: encrypted,
        createdAt: now,
        updatedAt: now,
      });
    return this.getById(id)!;
  }

  getById(id: string): ProxyRecord | null {
    const row = this.db.prepare('SELECT * FROM proxies WHERE id = ?').get(id) as ProxyRow | undefined;
    return row ? rowToProxy(row) : null;
  }

  getPassword(id: string): string | null {
    const row = this.db.prepare('SELECT encrypted_password FROM proxies WHERE id = ?').get(id) as
      | { encrypted_password: Buffer | null }
      | undefined;
    if (!row?.encrypted_password) return null;
    return decryptSecret(row.encrypted_password);
  }

  update(id: string, patch: Partial<ProxyInput>): ProxyRecord {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Proxy not found: ${id}`);
    const merged = { ...existing, ...patch };
    const encrypted =
      patch.password !== undefined
        ? patch.password
          ? encryptSecret(patch.password)
          : null
        : undefined;
    if (encrypted === undefined) {
      this.db
        .prepare(
          `UPDATE proxies SET name=@name, protocol=@protocol, host=@host, port=@port,
            username=@username, updated_at=@updatedAt WHERE id=@id`,
        )
        .run({ ...merged, id, updatedAt: new Date().toISOString() });
    } else {
      this.db
        .prepare(
          `UPDATE proxies SET name=@name, protocol=@protocol, host=@host, port=@port,
            username=@username, encrypted_password=@encryptedPassword, updated_at=@updatedAt WHERE id=@id`,
        )
        .run({ ...merged, id, encryptedPassword: encrypted, updatedAt: new Date().toISOString() });
    }
    return this.getById(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM proxies WHERE id = ?').run(id);
  }

  list(): ProxyRecord[] {
    const rows = this.db.prepare('SELECT * FROM proxies ORDER BY created_at DESC').all() as ProxyRow[];
    return rows.map(rowToProxy);
  }

  /** Records a health-check result (scheduled or manual) without touching
   * updated_at — a background check is not a user edit. Writes both the
   * single "most recent result" columns on the proxy row itself (what the
   * status pill in ProxiesPage.tsx reads) and an append-only history row
   * (what the history panel reads) — same write, two read shapes, so
   * neither one can drift out of sync with the other. */
  recordCheckResult(id: string, result: { success: boolean; latencyMs: number | null }): void {
    const status = result.success ? 'OK' : 'FAIL';
    const checkedAt = new Date().toISOString();
    const run = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE proxies SET last_check_status = ?, last_checked_at = ?, last_check_latency_ms = ? WHERE id = ?`)
        .run(status, checkedAt, result.latencyMs, id);
      this.db
        .prepare(`INSERT INTO proxy_check_history (id, proxy_id, status, latency_ms, checked_at) VALUES (?, ?, ?, ?, ?)`)
        .run(randomUUID(), id, status, result.latencyMs, checkedAt);
      // Trim to the most recent MAX_HISTORY_ROWS_PER_PROXY rows for this
      // proxy — cheap since it only runs once per check, not once per read.
      // Ordered by rowid, not checked_at, as the tiebreaker/primary sort:
      // checked_at is an ISO string with millisecond resolution, which two
      // inserts in the same millisecond (seen in practice under a tight
      // test loop, and not impossible in real use either) tie on, making
      // "ORDER BY checked_at DESC" alone non-deterministic about which one
      // sorts first. rowid is SQLite's own monotonically-increasing
      // insertion order, which checked_at can never contradict in this
      // table (rows are only ever inserted, never reordered), so it's a
      // correct and free tiebreak.
      this.db
        .prepare(
          `DELETE FROM proxy_check_history WHERE proxy_id = ? AND id NOT IN (
             SELECT id FROM proxy_check_history WHERE proxy_id = ? ORDER BY rowid DESC LIMIT ?
           )`,
        )
        .run(id, id, MAX_HISTORY_ROWS_PER_PROXY);
    });
    run();
  }

  /** Most recent checks for one proxy, newest first — see recordCheckResult()
   * for why this orders by rowid rather than (or in addition to) checked_at. */
  listCheckHistory(proxyId: string, limit = MAX_HISTORY_ROWS_PER_PROXY): ProxyCheckHistoryEntry[] {
    const rows = this.db
      .prepare('SELECT id, status, latency_ms, checked_at FROM proxy_check_history WHERE proxy_id = ? ORDER BY rowid DESC LIMIT ?')
      .all(proxyId, limit) as ProxyCheckHistoryRow[];
    return rows.map(rowToHistoryEntry);
  }
}
