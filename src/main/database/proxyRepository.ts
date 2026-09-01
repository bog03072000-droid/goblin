import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { ProxyInput, ProxyRecord } from '../../shared/schemas/proxy';
import { encryptSecret, decryptSecret } from '../security/credentialVault';

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
   * updated_at — a background check is not a user edit. */
  recordCheckResult(id: string, result: { success: boolean; latencyMs: number | null }): void {
    this.db
      .prepare(
        `UPDATE proxies SET last_check_status = ?, last_checked_at = ?, last_check_latency_ms = ? WHERE id = ?`,
      )
      .run(result.success ? 'OK' : 'FAIL', new Date().toISOString(), result.latencyMs, id);
  }
}
