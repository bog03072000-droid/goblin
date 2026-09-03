import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

// Same double as profileManagerErrors.test.ts, extended with a `channel`
// (sendChildRequest treats its absence as "not really running") and a
// `.send()` that's individually stubbed per test to emit back whatever
// response that test wants to simulate the child process replying with.
class FakeChildProcess extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
  channel = {};
  send = vi.fn();
}

let lastChild: FakeChildProcess;

vi.mock('../../src/main/browser/browserLauncher', () => ({
  launchProfileProcess: vi.fn(() => {
    lastChild = new FakeChildProcess();
    return lastChild;
  }),
}));

const { ProfileManager } = await import('../../src/main/profiles/profileManager');

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ProfileManager cookie editor (sendChildRequest)', () => {
  let db: Database.Database;
  let root: string;
  let manager: InstanceType<typeof ProfileManager>;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    (process.versions as Record<string, string>).chrome = '128.0.0.0';
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-cookies-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeRunningProfile(name: string) {
    const fp = fingerprints.create(generateFingerprint({ seed: name }));
    const profile = manager.create({ name }, fp.id);
    manager.start(profile.id);
    return profile;
  }

  it('rejects a cookie request against a profile that is not running', async () => {
    const fp = fingerprints.create(generateFingerprint({ seed: 'Stopped' }));
    const profile = manager.create({ name: 'Stopped' }, fp.id);
    await expect(manager.listCookies(profile.id)).rejects.toThrow(
      'Start the profile before viewing or editing its cookies',
    );
  });

  it('listCookies sends a cookies:list request and resolves with the child\'s reply, correlated by requestId', async () => {
    const profile = makeRunningProfile('List Cookies');
    lastChild.send.mockImplementation((msg: { requestId: string }) => {
      lastChild.emit('message', { type: 'cookies:list:result', requestId: msg.requestId, cookies: [{ name: 'a', value: '1' }] });
    });

    const cookies = await manager.listCookies(profile.id);

    expect(cookies).toEqual([{ name: 'a', value: '1' }]);
    expect(lastChild.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'cookies:list' }));
  });

  it('removeCookie sends the url/name and resolves once the child confirms', async () => {
    const profile = makeRunningProfile('Remove Cookie');
    lastChild.send.mockImplementation((msg: { requestId: string }) => {
      lastChild.emit('message', { type: 'cookies:remove:result', requestId: msg.requestId });
    });

    await expect(manager.removeCookie(profile.id, { url: 'https://example.com/', name: 'a' })).resolves.toBeUndefined();
    expect(lastChild.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'cookies:remove', url: 'https://example.com/', name: 'a' }),
    );
  });

  it('setCookie sends the cookie payload and resolves once the child confirms', async () => {
    const profile = makeRunningProfile('Set Cookie');
    lastChild.send.mockImplementation((msg: { requestId: string }) => {
      lastChild.emit('message', { type: 'cookies:set:result', requestId: msg.requestId });
    });

    const cookie = { url: 'https://example.com/', name: 'a', value: '1' };
    await expect(manager.setCookie(profile.id, cookie)).resolves.toBeUndefined();
    expect(lastChild.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'cookies:set', cookie }));
  });

  it('rejects with the child\'s own error message when it reports cookies:error', async () => {
    const profile = makeRunningProfile('Child Error');
    lastChild.send.mockImplementation((msg: { requestId: string }) => {
      lastChild.emit('message', { type: 'cookies:error', requestId: msg.requestId, error: 'net::ERR_INVALID_URL' });
    });

    await expect(manager.listCookies(profile.id)).rejects.toThrow('net::ERR_INVALID_URL');
  });

  it('a reply with a mismatched requestId is ignored (does not resolve/reject a concurrent, unrelated request)', async () => {
    const profile = makeRunningProfile('Mismatched Reply');
    lastChild.send.mockImplementation(() => {
      // Simulates a stray/late reply for a totally different request.
      lastChild.emit('message', { type: 'cookies:list:result', requestId: 'not-the-real-one', cookies: [] });
    });

    const pending = manager.listCookies(profile.id);
    // The mismatched reply above must not have resolved it — give the
    // event loop a turn, then confirm the real reply (matching requestId,
    // captured from the actual send() call) still resolves it correctly.
    await new Promise((r) => setTimeout(r, 0));
    const sentRequestId = (lastChild.send.mock.calls[0]![0] as { requestId: string }).requestId;
    lastChild.emit('message', { type: 'cookies:list:result', requestId: sentRequestId, cookies: [{ name: 'real', value: 'x' }] });

    await expect(pending).resolves.toEqual([{ name: 'real', value: 'x' }]);
  });

  it('retries the same request (same requestId) if the child is slow, rather than giving up on the first silence', async () => {
    vi.useFakeTimers();
    try {
      const profile = makeRunningProfile('Slow Start');
      // Simulate exactly the real race this was built to cover: the first
      // couple of attempts are silently dropped (child's IPC listener not
      // attached yet), and only the 3rd actually reaches a ready listener.
      let sendCount = 0;
      lastChild.send.mockImplementation((msg: { requestId: string }) => {
        sendCount++;
        if (sendCount >= 3) {
          lastChild.emit('message', { type: 'cookies:list:result', requestId: msg.requestId, cookies: [] });
        }
      });

      const pending = manager.listCookies(profile.id);
      await vi.advanceTimersByTimeAsync(2_500); // past 2 retries (1s apart), before the 5s give-up

      await expect(pending).resolves.toEqual([]);
      expect(sendCount).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out if the child never replies, rather than hanging forever', async () => {
    vi.useFakeTimers();
    try {
      const profile = makeRunningProfile('No Reply');
      // send() is a no-op here — the child never responds.
      const pending = manager.listCookies(profile.id);
      const assertion = expect(pending).rejects.toThrow('did not respond in time');
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
