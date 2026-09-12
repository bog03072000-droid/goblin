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
    expect(created.scheduleMode).toBe('recurring');
    expect(created.scheduleTimezone).toBeNull();
    expect(created.scheduleOneTimeAt).toBeNull();
  });

  it('update() persists scheduleMode/scheduleTimezone/scheduleOneTimeAt and round-trips them on a fresh read', () => {
    const created = makeProfile('p');
    const oneTimeAt = '2026-12-25T08:00:00.000Z';
    const updated = profiles.update(created.id, {
      scheduleEnabled: true,
      scheduleMode: 'once',
      scheduleTimezone: 'Europe/Kyiv',
      scheduleOneTimeAt: oneTimeAt,
    });
    expect(updated.scheduleMode).toBe('once');
    expect(updated.scheduleTimezone).toBe('Europe/Kyiv');
    expect(updated.scheduleOneTimeAt).toBe(oneTimeAt);

    const reread = profiles.getById(created.id)!;
    expect(reread.scheduleMode).toBe('once');
    expect(reread.scheduleTimezone).toBe('Europe/Kyiv');
    expect(reread.scheduleOneTimeAt).toBe(oneTimeAt);
  });

  it('switching scheduleMode back to "recurring" clears neither scheduleTimezone nor scheduleTime/scheduleDays — the caller decides what to clear, same as every other field', () => {
    const created = makeProfile('p');
    profiles.update(created.id, {
      scheduleMode: 'once',
      scheduleTimezone: 'Europe/Kyiv',
      scheduleOneTimeAt: '2026-12-25T08:00:00.000Z',
    });
    const backToRecurring = profiles.update(created.id, { scheduleMode: 'recurring', scheduleTime: '09:00', scheduleDays: [1] });
    expect(backToRecurring.scheduleMode).toBe('recurring');
    expect(backToRecurring.scheduleTimezone).toBe('Europe/Kyiv');
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

  describe('per-profile time zone', () => {
    it('a profile scheduled for 09:00 in a zone that is NOT the machine local zone does not fire at the machine-local 09:00', async () => {
      // WEDNESDAY_9AM is constructed via the local Date constructor
      // (new Date(2026, 8, 2, 9, 0, 0)) — i.e. it IS 09:00 in whatever zone
      // the test runner's machine is actually in. A profile scheduled for
      // "09:00 in Asia/Tokyo" should not fire at this instant unless the
      // test machine itself happens to be UTC+9 — asserting the negative
      // here, then the positive case below at the real matching instant,
      // is what actually proves scheduleTimezone is consulted at all
      // rather than silently ignored.
      const profile = makeProfile('TokyoScheduled');
      profiles.update(profile.id, {
        scheduleEnabled: true,
        scheduleTime: '09:00',
        scheduleDays: [3],
        scheduleTimezone: 'Asia/Tokyo',
      });

      const scheduler = new ProfileScheduler(profiles, manager, 60_000);
      // A UTC instant that is 09:00 local machine time but NOT 09:00 Tokyo
      // time, unless the machine itself is already UTC+9 — construct the
      // "definitely not Tokyo 09:00" instant directly in UTC instead of
      // relying on the machine's own offset.
      const notTokyo9am = new Date('2026-09-02T09:00:00Z'); // 18:00 in Tokyo
      await scheduler.runOnce(notTokyo9am);

      expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
    });

    it('a profile scheduled for 09:00 in Asia/Tokyo fires at the real UTC instant that is 09:00 in Tokyo, regardless of the machine\'s own local time', async () => {
      const profile = makeProfile('TokyoScheduled2');
      // 2026-09-02T00:00:00Z is exactly 09:00 on Wednesday in Tokyo (UTC+9).
      const tokyo9am = new Date('2026-09-02T00:00:00Z');
      profiles.update(profile.id, {
        scheduleEnabled: true,
        scheduleTime: '09:00',
        scheduleDays: [3],
        scheduleTimezone: 'Asia/Tokyo',
      });

      const scheduler = new ProfileScheduler(profiles, manager, 60_000);
      await scheduler.runOnce(tokyo9am);

      expect(profiles.getById(profile.id)!.status).toBe('RUNNING');
    });

    it('an invalid time zone name falls back to local time rather than crashing the whole poll (other profiles still get checked)', async () => {
      const bad = makeProfile('BadZone');
      const good = makeProfile('GoodZone');
      profiles.update(bad.id, {
        scheduleEnabled: true,
        scheduleTime: '09:00',
        scheduleDays: [3],
        scheduleTimezone: 'Not/AZone',
      });
      profiles.update(good.id, { scheduleEnabled: true, scheduleTime: '09:00', scheduleDays: [3] });

      const scheduler = new ProfileScheduler(profiles, manager, 60_000);
      // WEDNESDAY_9AM is 09:00 local time — the "bad" profile's invalid
      // zone should fall back to local time too, so it fires exactly like
      // the "good" profile rather than throwing and skipping every
      // profile after it in the same tick.
      await expect(scheduler.runOnce(WEDNESDAY_9AM)).resolves.toBeUndefined();

      expect(profiles.getById(bad.id)!.status).toBe('RUNNING');
      expect(profiles.getById(good.id)!.status).toBe('RUNNING');
    });
  });

  describe('one-time schedule (scheduleMode: "once")', () => {
    it('fires a due one-time schedule and then turns scheduleEnabled back off, so it never fires a second time', async () => {
      const profile = makeProfile('OneTime');
      const dueAt = new Date(WEDNESDAY_9AM.getTime() - 60_000).toISOString(); // one minute in the past
      profiles.update(profile.id, {
        scheduleEnabled: true,
        scheduleMode: 'once',
        scheduleOneTimeAt: dueAt,
      });

      const scheduler = new ProfileScheduler(profiles, manager, 60_000);
      await scheduler.runOnce(WEDNESDAY_9AM);

      const afterFirst = profiles.getById(profile.id)!;
      expect(afterFirst.status).toBe('RUNNING');
      expect(afterFirst.scheduleEnabled).toBe(false);
      expect(afterFirst.scheduleLastTriggeredAt).not.toBeNull();

      // Stop it and poll again much later — a re-enabled-looking schedule
      // (scheduleEnabled is now false) must not fire again regardless of
      // how much later the next poll runs.
      await manager.stop(profile.id);
      const muchLater = new Date(WEDNESDAY_9AM.getTime() + 24 * 60 * 60 * 1000);
      await scheduler.runOnce(muchLater);
      expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
    });

    it('does not fire a one-time schedule whose moment has not arrived yet', async () => {
      const profile = makeProfile('NotYetDue');
      const notYetDue = new Date(WEDNESDAY_9AM.getTime() + 60_000).toISOString(); // one minute in the future
      profiles.update(profile.id, {
        scheduleEnabled: true,
        scheduleMode: 'once',
        scheduleOneTimeAt: notYetDue,
      });

      const scheduler = new ProfileScheduler(profiles, manager, 60_000);
      await scheduler.runOnce(WEDNESDAY_9AM);

      expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
    });

    it('a one-time schedule with no scheduleOneTimeAt set never fires, even with scheduleEnabled true', async () => {
      const profile = makeProfile('MissingOneTime');
      profiles.update(profile.id, { scheduleEnabled: true, scheduleMode: 'once', scheduleOneTimeAt: null });

      const scheduler = new ProfileScheduler(profiles, manager, 60_000);
      await scheduler.runOnce(WEDNESDAY_9AM);

      expect(profiles.getById(profile.id)!.status).toBe('STOPPED');
    });
  });
});
