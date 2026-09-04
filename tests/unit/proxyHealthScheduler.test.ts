import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProxyRepository } from '../../src/main/database/proxyRepository';

const migrationsDir = path.join(__dirname, '../../database/migrations');

vi.mock('../../src/main/proxy/proxyTester', () => ({
  testProxyConnection: vi.fn(),
}));

const { testProxyConnection } = await import('../../src/main/proxy/proxyTester');
const { ProxyHealthScheduler } = await import('../../src/main/proxy/proxyHealthScheduler');

describe('ProxyRepository.recordCheckResult', () => {
  let db: Database.Database;
  let repo: ProxyRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    repo = new ProxyRepository(db);
  });

  it('starts null (never checked) and is filled in by recordCheckResult', () => {
    const created = repo.create({ name: 'p', protocol: 'http', host: '127.0.0.1', port: 8080 });
    expect(created.lastCheckStatus).toBeNull();
    expect(created.lastCheckedAt).toBeNull();
    expect(created.lastCheckLatencyMs).toBeNull();

    repo.recordCheckResult(created.id, { success: true, latencyMs: 42 });
    const updated = repo.getById(created.id)!;
    expect(updated.lastCheckStatus).toBe('OK');
    expect(updated.lastCheckLatencyMs).toBe(42);
    expect(updated.lastCheckedAt).not.toBeNull();
  });

  it('records FAIL with a null latency', () => {
    const created = repo.create({ name: 'p', protocol: 'http', host: '127.0.0.1', port: 8080 });
    repo.recordCheckResult(created.id, { success: false, latencyMs: null });
    const updated = repo.getById(created.id)!;
    expect(updated.lastCheckStatus).toBe('FAIL');
    expect(updated.lastCheckLatencyMs).toBeNull();
  });

  it("recordCheckResult does not touch updated_at (a background check isn't a user edit)", () => {
    const created = repo.create({ name: 'p', protocol: 'http', host: '127.0.0.1', port: 8080 });
    repo.recordCheckResult(created.id, { success: true, latencyMs: 10 });
    const updated = repo.getById(created.id)!;
    expect(updated.updatedAt).toBe(created.updatedAt);
  });
});

describe('ProxyRepository check history', () => {
  let db: Database.Database;
  let repo: ProxyRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    repo = new ProxyRepository(db);
  });

  it('starts empty and grows one row per recordCheckResult call, newest first', () => {
    const created = repo.create({ name: 'p', protocol: 'http', host: '127.0.0.1', port: 8080 });
    expect(repo.listCheckHistory(created.id)).toEqual([]);

    repo.recordCheckResult(created.id, { success: true, latencyMs: 42 });
    repo.recordCheckResult(created.id, { success: false, latencyMs: null });

    const history = repo.listCheckHistory(created.id);
    expect(history).toHaveLength(2);
    // Newest first: the second recorded check (FAIL) comes before the first (OK).
    expect(history[0]!.status).toBe('FAIL');
    expect(history[0]!.latencyMs).toBeNull();
    expect(history[1]!.status).toBe('OK');
    expect(history[1]!.latencyMs).toBe(42);
  });

  it('is scoped per proxy — one proxy\'s history never includes another\'s checks', () => {
    const a = repo.create({ name: 'a', protocol: 'http', host: '127.0.0.1', port: 8080 });
    const b = repo.create({ name: 'b', protocol: 'http', host: '127.0.0.1', port: 8081 });
    repo.recordCheckResult(a.id, { success: true, latencyMs: 1 });
    repo.recordCheckResult(b.id, { success: true, latencyMs: 2 });
    repo.recordCheckResult(b.id, { success: false, latencyMs: null });

    expect(repo.listCheckHistory(a.id)).toHaveLength(1);
    expect(repo.listCheckHistory(b.id)).toHaveLength(2);
  });

  it("listCheckHistory's own limit param caps the read independently of how many rows exist", () => {
    const created = repo.create({ name: 'p', protocol: 'http', host: '127.0.0.1', port: 8080 });
    for (let i = 0; i < 5; i++) {
      repo.recordCheckResult(created.id, { success: true, latencyMs: i });
    }
    const history = repo.listCheckHistory(created.id, 3);
    expect(history).toHaveLength(3);
    expect(history.map((h) => h.latencyMs)).toEqual([4, 3, 2]);
  });

  it('recordCheckResult trims the stored table itself to the last 50 rows per proxy, not just the read', () => {
    const created = repo.create({ name: 'p', protocol: 'http', host: '127.0.0.1', port: 8080 });
    for (let i = 0; i < 55; i++) {
      repo.recordCheckResult(created.id, { success: true, latencyMs: i });
    }
    const row = db.prepare('SELECT COUNT(*) as n FROM proxy_check_history WHERE proxy_id = ?').get(created.id) as { n: number };
    expect(row.n).toBe(50);
    // The kept rows are the most recent ones (latencyMs 5..54), not the
    // oldest (which would be a bug — trimming the wrong end).
    const kept = repo.listCheckHistory(created.id, 50).map((h) => h.latencyMs);
    expect(Math.min(...kept)).toBe(5);
    expect(Math.max(...kept)).toBe(54);
  });

  it('deleting a proxy cascades to its check history (no orphaned rows)', () => {
    const created = repo.create({ name: 'p', protocol: 'http', host: '127.0.0.1', port: 8080 });
    repo.recordCheckResult(created.id, { success: true, latencyMs: 1 });
    repo.delete(created.id);
    // A direct query, not repo.listCheckHistory(), since that would return
    // [] for a nonexistent id regardless — this confirms the row is truly
    // gone, not just unreachable through the repository's own id filter.
    const remaining = db.prepare('SELECT COUNT(*) as n FROM proxy_check_history WHERE proxy_id = ?').get(created.id) as { n: number };
    expect(remaining.n).toBe(0);
  });
});

describe('ProxyHealthScheduler.runOnce', () => {
  let db: Database.Database;
  let repo: ProxyRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createTestDb(migrationsDir);
    repo = new ProxyRepository(db);
  });

  it('checks every stored proxy and persists each result', async () => {
    const a = repo.create({ name: 'a', protocol: 'http', host: '127.0.0.1', port: 8080 });
    const b = repo.create({ name: 'b', protocol: 'http', host: '127.0.0.1', port: 8081 });

    vi.mocked(testProxyConnection).mockImplementation(async (proxy) => {
      return proxy.id === a.id
        ? { success: true, latencyMs: 5, error: null }
        : { success: false, latencyMs: null, error: 'ECONNREFUSED' };
    });

    const scheduler = new ProxyHealthScheduler(repo, 60_000);
    await scheduler.runOnce();

    expect(repo.getById(a.id)!.lastCheckStatus).toBe('OK');
    expect(repo.getById(b.id)!.lastCheckStatus).toBe('FAIL');
    expect(testProxyConnection).toHaveBeenCalledTimes(2);
  });

  it("one proxy's check throwing does not stop the rest of the batch from being checked", async () => {
    const a = repo.create({ name: 'a', protocol: 'http', host: '127.0.0.1', port: 8080 });
    const b = repo.create({ name: 'b', protocol: 'http', host: '127.0.0.1', port: 8081 });

    vi.mocked(testProxyConnection).mockImplementation(async (proxy) => {
      if (proxy.id === a.id) throw new Error('unexpected socket failure');
      return { success: true, latencyMs: 7, error: null };
    });

    const scheduler = new ProxyHealthScheduler(repo, 60_000);
    await scheduler.runOnce();

    expect(repo.getById(a.id)!.lastCheckStatus).toBeNull(); // never recorded — threw before recordCheckResult
    expect(repo.getById(b.id)!.lastCheckStatus).toBe('OK');
  });
});
