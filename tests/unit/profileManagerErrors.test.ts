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

// A fake ChildProcess: profileManager only ever calls .pid, .kill(), and
// .on('exit'|'error', ...) on what launchProfileProcess returns, so a bare
// EventEmitter with those two extra members is a faithful enough double —
// this is what lets these tests exercise start()'s real error paths without
// actually spawning a second Electron/Chromium OS process per assertion.
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
  // Real implementation, not a mock — the retry tests below need the actual
  // transient/permanent error-code classification, not a stubbed one.
  isTransientSpawnError: (err: unknown) => {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    return code === 'EAGAIN' || code === 'EMFILE' || code === 'ENFILE' || code === 'ENOMEM';
  },
}));

const { ProfileManager } = await import('../../src/main/profiles/profileManager');
const { launchProfileProcess } = await import('../../src/main/browser/browserLauncher');

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ProfileManager error handling', () => {
  let db: Database.Database;
  let root: string;
  let manager: InstanceType<typeof ProfileManager>;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    // start() calls checkBrowserCompatibility(), which reads
    // process.versions.chrome — present in the real Electron runtime this
    // code actually ships in, but absent under plain Node (vitest), so it
    // needs stubbing here purely to let start() run at all in this test file.
    (process.versions as Record<string, string>).chrome = '128.0.0.0';
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-mgr-err-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeProfile(name: string) {
    const fp = fingerprints.create(generateFingerprint({ seed: name }));
    return manager.create({ name }, fp.id);
  }

  it('starting an already-running profile throws a specific, recognizable error', () => {
    const profile = makeProfile('Already Running');
    manager.start(profile.id);
    expect(() => manager.start(profile.id)).toThrow('Profile is already running');
  });

  it('stopping an already-stopped profile is graceful, not an error', async () => {
    const profile = makeProfile('Never Started');
    const result = await manager.stop(profile.id);
    expect(result.status).toBe('STOPPED');
  });

  it('starting a profile whose storage directory was deleted outside the app throws a specific error and marks it ERROR', () => {
    const profile = makeProfile('Deleted Storage');
    fs.rmSync(profile.profilePath, { recursive: true, force: true });
    expect(() => manager.start(profile.id)).toThrow('Profile storage directory is missing');
    expect(profiles.getById(profile.id)!.status).toBe('ERROR');
  });

  it('an asynchronous spawn failure (child "error" event) marks the profile ERROR instead of leaving it stuck STARTING', async () => {
    const profile = makeProfile('Bad Spawn');
    manager.start(profile.id);
    expect(profiles.getById(profile.id)!.status).toBe('RUNNING');

    lastChild.emit('error', new Error('spawn electron.exe ENOENT'));

    expect(profiles.getById(profile.id)!.status).toBe('ERROR');
    expect(manager.isRunning(profile.id)).toBe(false);
  });

  it('a transient spawn error (e.g. EAGAIN) retries and recovers instead of marking the profile ERROR immediately', async () => {
    vi.useFakeTimers();
    try {
      const profile = makeProfile('Transient Retry');
      manager.start(profile.id);
      const firstChild = lastChild;
      expect(manager.isRunning(profile.id)).toBe(true);

      const transientErr = Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' });
      firstChild.emit('error', transientErr);

      // Still not given up yet — retry is scheduled, not yet fired.
      expect(profiles.getById(profile.id)!.status).not.toBe('ERROR');
      expect(manager.isRunning(profile.id)).toBe(false);

      await vi.advanceTimersByTimeAsync(500);

      // launchProfileProcess was called again by the retry and succeeded
      // (the mock always returns a fresh working FakeChildProcess), so the
      // profile should be back to RUNNING against the new child.
      expect(vi.mocked(launchProfileProcess)).toHaveBeenCalledTimes(2);
      expect(profiles.getById(profile.id)!.status).toBe('RUNNING');
      expect(manager.isRunning(profile.id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a transient spawn error exhausts its retries and marks the profile ERROR if every attempt fails', async () => {
    vi.useFakeTimers();
    try {
      const profile = makeProfile('Transient Exhausted');
      manager.start(profile.id);

      const transientErr = () => Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' });
      // Attempt 1 (from start()) fails, then 2 retries (attempts 2 and 3)
      // also fail — 3 total attempts, matching MAX_SPAWN_RETRIES = 2.
      lastChild.emit('error', transientErr());
      await vi.advanceTimersByTimeAsync(500);
      lastChild.emit('error', transientErr());
      await vi.advanceTimersByTimeAsync(500);
      lastChild.emit('error', transientErr());

      expect(vi.mocked(launchProfileProcess)).toHaveBeenCalledTimes(3);
      expect(profiles.getById(profile.id)!.status).toBe('ERROR');
      expect(manager.isRunning(profile.id)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a non-transient spawn error (e.g. ENOENT) marks the profile ERROR immediately without retrying', () => {
    const profile = makeProfile('Non Transient');
    manager.start(profile.id);

    lastChild.emit('error', Object.assign(new Error('spawn electron.exe ENOENT'), { code: 'ENOENT' }));

    expect(vi.mocked(launchProfileProcess)).toHaveBeenCalledTimes(1);
    expect(profiles.getById(profile.id)!.status).toBe('ERROR');
    expect(manager.isRunning(profile.id)).toBe(false);
  });

  it('an exit with no stop() in flight and a nonzero code is a genuine crash', () => {
    const profile = makeProfile('Real Crash');
    manager.start(profile.id);
    lastChild.emit('exit', 1, null);
    expect(profiles.getById(profile.id)!.status).toBe('CRASHED');
  });

  it('an exit while stop() is in flight is classified STOPPED even with an abnormal nonzero exit code — root cause of the resourceManagement.spec.ts CRASHED flake: stopping a profile very soon after starting it can make Windows report a nonzero exit code (observed: 4294930435 / 0xFFFF7003) for an entirely ordinary, requested stop, not a real crash', async () => {
    const profile = makeProfile('Stop Race');
    manager.start(profile.id);
    const stopPromise = manager.stop(profile.id);
    // kill() is mocked (see FakeChildProcess) and never emits on its own —
    // simulate the real OS-level exit callback stop() is waiting on, with
    // the same kind of abnormal code seen in the real repro.
    lastChild.emit('exit', 4294930435, null);
    await stopPromise;
    expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
  });

  it('a synchronous throw from launchProfileProcess marks the profile ERROR and rethrows', () => {
    vi.mocked(launchProfileProcess).mockImplementationOnce(() => {
      throw new Error('spawn ENOENT');
    });
    const profile = makeProfile('Sync Throw');
    expect(() => manager.start(profile.id)).toThrow('spawn ENOENT');
    expect(profiles.getById(profile.id)!.status).toBe('ERROR');
  });

  it('reading a fingerprint with corrupted languages JSON throws a specific, recognizable error instead of an unhandled JSON.parse crash', () => {
    const profile = makeProfile('Corrupted Fingerprint');
    db.prepare('UPDATE fingerprints SET languages = ? WHERE id = ?').run('{not-json', profile.fingerprintId);
    expect(() => fingerprints.getById(profile.fingerprintId)).toThrow('Corrupted fingerprint data');
  });
});
