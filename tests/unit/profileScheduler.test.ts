import { describe, it, expect, vi, beforeEach } from 'vitest';
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

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  // Auto-emits 'exit' so ProfileManager.stop() (which awaits the child's
  // real 'exit' event) resolves instead of hanging — this fake has no
  // `channel`, so stop() always takes the hard-kill path, never the
  // graceful-quit one.
  kill = vi.fn(() => {
    this.emit('exit', 0, null);
  });
}

vi.mock('../../src/main/browser/browserLauncher', () => ({
  launchProfileProcess: vi.fn(() => new FakeChildProcess()),
  isTransientSpawnError: () => false,
}));

const { ProfileManager } = await import('../../src/main/profiles/profileManager');
const { ProfileScheduler } = await import('../../src/main/profiles/profileScheduler');

const migrationsDir = path.join(__dirname, '../../database/migrations');

describe('ProfileRepository schedule fields', () => {
  let db: Database.Database;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
  });

  function makeProfile(name: string) {
    const fp = fingerprints.create(generateFingerprint({ seed: name }));
    return profiles.create({ name, profilePath: `/tmp/${name}`, fingerprintId: fp.id, proxyId: null });
  }

  it('a new profile starts with scheduling off and every schedule field empty', () => {
    const created = makeProfile('p');
    expect(created.scheduleEnabled).toBe(false);
    expect(created.scheduleTime).toBeNull();
    expect(created.scheduleDays).toBeNull();
    expect(created.scheduleLastTriggeredAt).toBeNull();
  });

  it('update() persists scheduleEnabled/scheduleTime/scheduleDays and round-trips scheduleDays as a real array', () => {
    const created = makeProfile('p');
    const updated = profiles.update(created.id, { scheduleEnabled: true, scheduleTime: '14:30', scheduleDays: [1, 3, 5] });
    expect(updated.scheduleEnabled).toBe(true);
    expect(updated.scheduleTime).toBe('14:30');
    expect(updated.scheduleDays).toEqual([1, 3, 5]);

    // Also confirmed via a fresh read, not just the update() return value.
    const reread = profiles.getById(created.id)!;
    expect(reread.scheduleDays).toEqual([1, 3, 5]);
  });

  it('update() with an empty patch leaves existing schedule fields untouched', () => {
    const created = makeProfile('p');
    profiles.update(created.id, { scheduleEnabled: true, scheduleTime: '08:00', scheduleDays: [0] });
    const untouched = profiles.update(created.id, { name: 'renamed' });
    expect(untouched.scheduleEnabled).toBe(true);
    expect(untouched.scheduleTime).toBe('08:00');
    expect(untouched.scheduleDays).toEqual([0]);
  });

  it('listScheduled() returns only profiles with scheduling enabled', () => {
    const on = makeProfile('on');
    makeProfile('off'); // scheduleEnabled defaults to false — must not appear
    profiles.update(on.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] });

    const scheduled = profiles.listScheduled();
    expect(scheduled.map((p) => p.id)).toEqual([on.id]);
  });

  it('listScheduled() excludes soft-deleted profiles even if scheduling is enabled', () => {
    const deleted = makeProfile('deleted');
    profiles.update(deleted.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] });
    profiles.softDelete(deleted.id);

    expect(profiles.listScheduled()).toEqual([]);
  });

  it('recordScheduleTriggered() sets scheduleLastTriggeredAt without touching updatedAt', () => {
    const created = makeProfile('p');
    profiles.update(created.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1] });
    const before = profiles.getById(created.id)!;

    profiles.recordScheduleTriggered(created.id, '2026-09-02T09:00:00.000Z');
    const after = profiles.getById(created.id)!;

    expect(after.scheduleLastTriggeredAt).toBe('2026-09-02T09:00:00.000Z');
    expect(after.updatedAt).toBe(before.updatedAt);
  });
});

describe('ProfileScheduler.runOnce', () => {
  let db: Database.Database;
  let root: string;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;
  let manager: InstanceType<typeof ProfileManager>;

  beforeEach(() => {
    vi.clearAllMocks();
    (process.versions as Record<string, string>).chrome = '128.0.0.0';
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-scheduler-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
  });

  function makeProfile(name: string) {
    const fp = fingerprints.create(generateFingerprint({ seed: name }));
    return manager.create({ name }, fp.id);
  }

  // Wednesday, 09:00 local time — used as "now" across most tests below so
  // day-of-week (3) and time ("09:00") match a profile scheduled for that
  // exact slot without every test having to compute it separately.
  const WEDNESDAY_9AM = new Date(2026, 8, 2, 9, 0, 0); // 2026-09-02 is a Wednesday

  it('starts a profile whose schedule matches the current time and day', async () => {
    const profile = makeProfile('Scheduled');
    profiles.update(profile.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3] });

    const scheduler = new ProfileScheduler(profiles, manager, 60_000);
    await scheduler.runOnce(WEDNESDAY_9AM);

    expect(profiles.getById(profile.id)!.status).toBe('RUNNING');
  });

  it('does not start a profile whose scheduled time does not match', async () => {
    const profile = makeProfile('Scheduled');
    profiles.update(profile.id, { scheduleEnabled: true, scheduleTime: '10:00', scheduleDays: [3] });

    const scheduler = new ProfileScheduler(profiles, manager, 60_000);
    await scheduler.runOnce(WEDNESDAY_9AM);

    expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
  });

  it('does not start a profile whose scheduled day does not include today', async () => {
    const profile = makeProfile('Scheduled');
    profiles.update(profile.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [1, 2] }); // Mon/Tue only

    const scheduler = new ProfileScheduler(profiles, manager, 60_000);
    await scheduler.runOnce(WEDNESDAY_9AM);

    expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
  });

  it('does not touch a profile with scheduling disabled, even at its old scheduled time', async () => {
    const profile = makeProfile('WasScheduled');
    profiles.update(profile.id, { scheduleEnabled: false, scheduleTime: '09:00', scheduleDays: [3] });

    const scheduler = new ProfileScheduler(profiles, manager, 60_000);
    await scheduler.runOnce(WEDNESDAY_9AM);

    expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
  });

  it('does not start a profile that is already RUNNING', async () => {
    const profile = makeProfile('AlreadyRunning');
    profiles.update(profile.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3] });
    manager.start(profile.id);
    expect(profiles.getById(profile.id)!.status).toBe('RUNNING');

    const scheduler = new ProfileScheduler(profiles, manager, 60_000);
    // Should not throw "Profile is already running" out of runOnce(), and
    // should not attempt a second start.
    await expect(scheduler.runOnce(WEDNESDAY_9AM)).resolves.toBeUndefined();
  });

  it('does not fire twice for the same matching minute across two consecutive polls', async () => {
    const profile = makeProfile('Scheduled');
    profiles.update(profile.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3] });

    const scheduler = new ProfileScheduler(profiles, manager, 60_000);
    await scheduler.runOnce(WEDNESDAY_9AM);
    expect(profiles.getById(profile.id)!.status).toBe('RUNNING');

    // Stop it (simulating the user manually stopping right after the
    // scheduled start) and poll again a few seconds later, still within the
    // same real-world minute — should NOT restart it, since it already
    // fired for this exact minute.
    await manager.stop(profile.id);
    const stillSameMinute = new Date(WEDNESDAY_9AM.getTime() + 15_000);
    await scheduler.runOnce(stillSameMinute);

    expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
  });

  it('fires again the next day at the same scheduled time (a new minuteKey)', async () => {
    const profile = makeProfile('Scheduled');
    profiles.update(profile.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3, 4] }); // Wed + Thu

    const scheduler = new ProfileScheduler(profiles, manager, 60_000);
    await scheduler.runOnce(WEDNESDAY_9AM);
    expect(profiles.getById(profile.id)!.status).toBe('RUNNING');
    await manager.stop(profile.id);

    const nextDaySameTime = new Date(2026, 8, 3, 9, 0, 0); // Thursday 09:00
    await scheduler.runOnce(nextDaySameTime);
    expect(profiles.getById(profile.id)!.status).toBe('RUNNING');
  });

  it("one profile's schedule failing to start does not stop other profiles' schedules from being checked", async () => {
    const bad = makeProfile('Bad');
    const good = makeProfile('Good');
    profiles.update(bad.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3] });
    profiles.update(good.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3] });
    // Make the "bad" profile's storage directory missing, matching
    // ProfileManager.start()'s existing "Profile storage directory is
    // missing" failure path.
    fs.rmSync(bad.profilePath, { recursive: true, force: true });

    const scheduler = new ProfileScheduler(profiles, manager, 60_000);
    await scheduler.runOnce(WEDNESDAY_9AM);

    expect(profiles.getById(bad.id)!.status).toBe('ERROR');
    expect(profiles.getById(good.id)!.status).toBe('RUNNING');
  });
});
