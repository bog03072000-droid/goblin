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
