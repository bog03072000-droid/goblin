import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { createTestDb } from '../../src/main/database/db';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { ProfileChildChannel } from '../../src/main/profiles/profileChildChannel';

const migrationsDir = path.join(__dirname, '../../database/migrations');

/** Same fake-child-process double this project's other ProfileManager tests
 * use (see profileCookies.test.ts / automationProxyReady.test.ts) — tested
 * standalone here without ProfileManager at all, which is the actual point
 * of this class existing separately: the cookie/localStorage/automation-
 * readiness protocol has no dependency on process lifecycle, lock files, or
 * DB profile status, and this test file proves that by never touching any
 * of them. */
class FakeChildProcess extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
  channel = {};
  send = vi.fn();
}

describe('ProfileChildChannel', () => {
  let channel: ProfileChildChannel;
  let child: FakeChildProcess;

  beforeEach(() => {
    const db = createTestDb(migrationsDir);
    const logs = new ActivityLogRepository(db);
    channel = new ProfileChildChannel(logs);
    child = new FakeChildProcess();
  });

  it('rejects a cookie request when no child process is passed (profile not running)', async () => {
    await expect(channel.listCookies(undefined)).rejects.toThrow(
      'Start the profile before viewing or editing its cookies',
    );
  });

  it('listCookies sends a cookies:list request and resolves with the reply, correlated by requestId', async () => {
    child.send.mockImplementation((msg: { requestId: string }) => {
      child.emit('message', { type: 'cookies:list:result', requestId: msg.requestId, cookies: [{ name: 'a', value: '1' }] });
    });

    const cookies = await channel.listCookies(child as unknown as ChildProcess);

    expect(cookies).toEqual([{ name: 'a', value: '1' }]);
    expect(child.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'cookies:list' }));
  });

  it('removeCookie/setCookie/localStorage methods resolve once the child confirms, and record an activity log entry', async () => {
    child.send.mockImplementation((msg: { requestId: string; type: string }) => {
      child.emit('message', { type: `${msg.type}:result`, requestId: msg.requestId, origin: 'https://example.com', items: [] });
    });

    await expect(
      channel.removeCookie(child as unknown as ChildProcess, 'profile-1', { url: 'https://example.com/', name: 'a' }),
    ).resolves.toBeUndefined();
    await expect(
      channel.setCookie(child as unknown as ChildProcess, 'profile-1', { url: 'https://example.com/', name: 'a', value: '1' }),
    ).resolves.toBeUndefined();
    const listed = await channel.listLocalStorage(child as unknown as ChildProcess);
    expect(listed).toEqual({ origin: 'https://example.com', items: [] });
    await expect(
      channel.setLocalStorageItem(child as unknown as ChildProcess, 'profile-1', { key: 'k', value: 'v' }),
    ).resolves.toBeUndefined();
    await expect(
      channel.removeLocalStorageItem(child as unknown as ChildProcess, 'profile-1', 'k'),
    ).resolves.toBeUndefined();
  });

  it('waitForAutomationReady resolves once registerChild sees the ready message, even for a caller who asked first', async () => {
    const pending = channel.waitForAutomationReady('profile-1', true);
    channel.registerChild('profile-1', child as unknown as ChildProcess);

    child.emit('message', { type: 'automation-proxy:ready' });

    await expect(pending).resolves.toBeUndefined();
  });

  it('waitForAutomationReady rejects immediately when isRunning is false, without touching the child at all', async () => {
    await expect(channel.waitForAutomationReady('profile-1', false)).rejects.toThrow('Profile is not running');
  });

  it('unregisterChild rejects any pending waiter — proves ProfileManager\'s exit handler wiring is what this method is for', async () => {
    channel.registerChild('profile-1', child as unknown as ChildProcess);
    const pending = channel.waitForAutomationReady('profile-1', true);

    channel.unregisterChild('profile-1');

    await expect(pending).rejects.toThrow('Profile stopped before its automation proxy became ready');
  });
});
