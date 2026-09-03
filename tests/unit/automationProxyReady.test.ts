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

// Same double as profileCookies.test.ts.
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

/**
 * Proves the RUNNING-status-vs-actually-bound race identified for the
 * cookie editor (see profileCookies.test.ts and sendChildRequest's own doc
 * comment) does NOT also affect waitForAutomationReady() — the same class
 * of race automationApi.spec.ts's own comment documents needing an
 * artificial delay to tolerate. Unlike cookies this is a one-directional,
 * unsolicited notification (the child was never asked, so there's nothing
 * to resend), so what's actually being proven here is that a caller can
 * land on EITHER side of that one message — before or after it arrives —
 * and still get the correct result rather than a stale/premature one.
 */
describe('ProfileManager.waitForAutomationReady', () => {
  let db: Database.Database;
  let root: string;
  let manager: InstanceType<typeof ProfileManager>;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    (process.versions as Record<string, string>).chrome = '128.0.0.0';
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-automation-ready-'));
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

  it('rejects when the profile is not running at all', async () => {
    const fp = fingerprints.create(generateFingerprint({ seed: 'Stopped' }));
    const profile = manager.create({ name: 'Stopped' }, fp.id);
    await expect(manager.waitForAutomationReady(profile.id)).rejects.toThrow('Profile is not running');
  });

  it('resolves immediately if the ready message already arrived before the caller asked', async () => {
    const profile = makeRunningProfile('Already Ready');
    lastChild.emit('message', { type: 'automation-proxy:ready' });

    await expect(manager.waitForAutomationReady(profile.id)).resolves.toBeUndefined();
  });

  it('waits for the ready message when the caller asks before it has arrived — the actual race', async () => {
    const profile = makeRunningProfile('Race Window');
    // Nothing has emitted 'automation-proxy:ready' yet at this point — this
    // is exactly the window right after start() marks RUNNING and before
    // the child's whenReady()/startAutomationProxy() has settled.
    const pending = manager.waitForAutomationReady(profile.id);

    await new Promise((r) => setTimeout(r, 0));
    lastChild.emit('message', { type: 'automation-proxy:ready' });

    await expect(pending).resolves.toBeUndefined();
  });

  it('rejects with the child\'s own error message when the proxy failed to bind', async () => {
    const profile = makeRunningProfile('Bind Failed');
    const pending = manager.waitForAutomationReady(profile.id);
    lastChild.emit('message', { type: 'automation-proxy:error', error: 'listen EADDRINUSE: 19222' });

    await expect(pending).rejects.toThrow('listen EADDRINUSE: 19222');
  });

  it('a cached error answers a later caller too, without waiting again', async () => {
    const profile = makeRunningProfile('Cached Error');
    lastChild.emit('message', { type: 'automation-proxy:error', error: 'listen EADDRINUSE: 19222' });

    await expect(manager.waitForAutomationReady(profile.id)).rejects.toThrow('listen EADDRINUSE: 19222');
  });

  it('times out rather than hanging forever if the proxy never reports readiness', async () => {
    vi.useFakeTimers();
    try {
      const profile = makeRunningProfile('Never Ready');
      const pending = manager.waitForAutomationReady(profile.id, 5_000);
      const assertion = expect(pending).rejects.toThrow('did not become ready in time');
      await vi.advanceTimersByTimeAsync(5_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects any pending waiter if the profile process exits before the proxy became ready', async () => {
    const profile = makeRunningProfile('Exits Early');
    const pending = manager.waitForAutomationReady(profile.id);

    lastChild.emit('exit', 1, null);

    await expect(pending).rejects.toThrow('Profile stopped before its automation proxy became ready');
  });
});
