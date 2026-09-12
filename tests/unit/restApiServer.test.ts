import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { TemplateRepository } from '../../src/main/database/templateRepository';
import { startRestApiServer, type RestApiServerHandle } from '../../src/main/api/restApiServer';
import { findFreePort } from '../../src/main/browser/automationProxy';

// The /start and /stop route tests exercise ProfileManager.start()/.stop(),
// which calls checkBrowserCompatibility() (needs process.versions.chrome,
// present in the real Electron runtime but absent under plain Node/vitest)
// and launchProfileProcess() (which would otherwise spawn a real second
// Electron/Chromium OS process per test) — same fake-child-process mocking
// pattern as profileManagerErrors.test.ts, reused here rather than
// reinvented, so this file can exercise start()/stop() without either
// problem.
class FakeChildProcess extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
}
let lastChild: FakeChildProcess;
vi.mock('../../src/main/browser/browserLauncher', () => ({
  launchProfileProcess: vi.fn(() => {
    lastChild = new FakeChildProcess();
    return lastChild;
  }),
  isTransientSpawnError: () => false,
}));
const { ProfileManager } = await import('../../src/main/profiles/profileManager');

const TOKEN = 'test-rest-api-token';

interface Resp {
  status: number;
  body: unknown;
}

function request(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      { method, headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : undefined });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

describe('restApiServer', () => {
  let db: Database.Database;
  let root: string;
  let profiles: ProfileRepository;
  let profileManager: InstanceType<typeof ProfileManager>;
  let handle: RestApiServerHandle;
  let port: number;
  let baseUrl: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    (process.versions as Record<string, string>).chrome = '128.0.0.0';
    db = createTestDb(path.join(__dirname, '../../database/migrations'));
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-rest-api-'));
    profiles = new ProfileRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    const templates = new TemplateRepository(db);
    profileManager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
    port = await findFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    handle = await startRestApiServer({ port, token: TOKEN, deps: { profiles, profileManager, templates, fingerprints } });
  });

  afterEach(() => {
    handle.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('rejects a request with no token at all', async () => {
    const res = await request('GET', `${baseUrl}/profiles`);
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong token', async () => {
    const res = await request('GET', `${baseUrl}/profiles?token=wrong`);
    expect(res.status).toBe(401);
  });

  it('accepts the token via query parameter', async () => {
    const res = await request('GET', `${baseUrl}/profiles?token=${TOKEN}`);
    expect(res.status).toBe(200);
  });

  it('accepts the token via Authorization: Bearer header', async () => {
    const res = await request('GET', `${baseUrl}/profiles`, undefined, { authorization: `Bearer ${TOKEN}` });
    expect(res.status).toBe(200);
  });

  it('POST /profiles creates a real profile with a real fingerprint and on-disk directory', async () => {
    const res = await request('POST', `${baseUrl}/profiles?token=${TOKEN}`, { name: 'REST Profile', fingerprint: { os: 'windows' } });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; name: string; profilePath: string; fingerprintId: string };
    expect(body.name).toBe('REST Profile');
    expect(fs.existsSync(body.profilePath)).toBe(true);
    expect(profiles.getById(body.id)).not.toBeNull();
  });

  it('POST /profiles rejects an invalid body with 400, creating nothing', async () => {
    const res = await request('POST', `${baseUrl}/profiles?token=${TOKEN}`, { name: '' });
    expect(res.status).toBe(400);
    expect(profiles.list()).toHaveLength(0);
  });

  it('GET /profiles lists every created profile', async () => {
    await request('POST', `${baseUrl}/profiles?token=${TOKEN}`, { name: 'A' });
    await request('POST', `${baseUrl}/profiles?token=${TOKEN}`, { name: 'B' });
    const res = await request('GET', `${baseUrl}/profiles?token=${TOKEN}`);
    const body = res.body as Array<{ name: string }>;
    expect(body.map((p) => p.name).sort()).toEqual(['A', 'B']);
  });

  it('GET /profiles/:id returns one profile, 404 for an unknown id', async () => {
    const created = (await request('POST', `${baseUrl}/profiles?token=${TOKEN}`, { name: 'GetMe' })).body as { id: string };
    const found = await request('GET', `${baseUrl}/profiles/${created.id}?token=${TOKEN}`);
    expect(found.status).toBe(200);
    expect((found.body as { name: string }).name).toBe('GetMe');

    const missing = await request('GET', `${baseUrl}/profiles/00000000-0000-0000-0000-000000000000?token=${TOKEN}`);
    expect(missing.status).toBe(404);
  });

  it('PATCH /profiles/:id updates a field, 404 for an unknown id', async () => {
    const created = (await request('POST', `${baseUrl}/profiles?token=${TOKEN}`, { name: 'Original' })).body as { id: string };
    const patched = await request('PATCH', `${baseUrl}/profiles/${created.id}?token=${TOKEN}`, { name: 'Renamed' });
    expect(patched.status).toBe(200);
    expect((patched.body as { name: string }).name).toBe('Renamed');
    expect(profiles.getById(created.id)!.name).toBe('Renamed');

    const missing = await request('PATCH', `${baseUrl}/profiles/00000000-0000-0000-0000-000000000000?token=${TOKEN}`, { name: 'X' });
    expect(missing.status).toBe(404);
  });

  it('DELETE /profiles/:id soft-deletes a real profile, 404 for an unknown id', async () => {
    const created = (await request('POST', `${baseUrl}/profiles?token=${TOKEN}`, { name: 'ToDelete' })).body as { id: string };
    const deleted = await request('DELETE', `${baseUrl}/profiles/${created.id}?token=${TOKEN}`);
    expect(deleted.status).toBe(204);
    expect(profiles.list().find((p) => p.id === created.id)).toBeUndefined();

    const missing = await request('DELETE', `${baseUrl}/profiles/00000000-0000-0000-0000-000000000000?token=${TOKEN}`);
    expect(missing.status).toBe(404);
  });

  it('POST /profiles/:id/start and /stop actually start and stop a real profile process', async () => {
    const created = (await request('POST', `${baseUrl}/profiles?token=${TOKEN}`, { name: 'Startable' })).body as { id: string };
    const started = await request('POST', `${baseUrl}/profiles/${created.id}/start?token=${TOKEN}`);
    expect(started.status).toBe(200);
    expect(profileManager.isRunning(created.id)).toBe(true);

    // ProfileManager.stop() awaits the real child's 'exit' event before
    // resolving — the fake child's kill() is a bare vi.fn() stub that
    // doesn't emit anything on its own, so the exit is fired here once the
    // stop route has had a moment to call kill(), same as
    // profileManagerErrors.test.ts's own stop() tests do.
    const stopPromise = request('POST', `${baseUrl}/profiles/${created.id}/stop?token=${TOKEN}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    lastChild.emit('exit', 0, null);
    const stopped = await stopPromise;
    expect(stopped.status).toBe(200);
    expect(profileManager.isRunning(created.id)).toBe(false);
  }, 20_000);

  it('an unknown route returns 404', async () => {
    const res = await request('GET', `${baseUrl}/nonexistent?token=${TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('an unsupported method on a known route returns 405', async () => {
    const res = await request('PUT', `${baseUrl}/profiles?token=${TOKEN}`);
    expect(res.status).toBe(405);
  });
});
