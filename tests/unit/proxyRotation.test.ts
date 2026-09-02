import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createTestDb } from '../../src/main/database/db';
import { GroupRepository } from '../../src/main/database/groupRepository';
import { ProxyRepository } from '../../src/main/database/proxyRepository';
import { ProfileRepository } from '../../src/main/database/profileRepository';
import { FingerprintRepository } from '../../src/main/database/fingerprintRepository';
import { ActivityLogRepository } from '../../src/main/database/activityLogRepository';
import { generateFingerprint } from '../../src/main/fingerprint/generator';

const migrationsDir = path.join(__dirname, '../../database/migrations');

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  kill = vi.fn();
}

vi.mock('../../src/main/browser/browserLauncher', () => ({
  launchProfileProcess: vi.fn(() => new FakeChildProcess()),
}));

const { launchProfileProcess } = await import('../../src/main/browser/browserLauncher');
const { ProfileManager } = await import('../../src/main/profiles/profileManager');

describe('GroupRepository proxy pool / rotation', () => {
  let db: Database.Database;
  let groups: GroupRepository;
  let proxies: ProxyRepository;

  beforeEach(() => {
    db = createTestDb(migrationsDir);
    groups = new GroupRepository(db);
    proxies = new ProxyRepository(db);
  });

  function makeProxy(name: string) {
    return proxies.create({ name, protocol: 'http', host: '127.0.0.1', port: 8080 });
  }

  it('an empty pool means pickNextPoolProxy returns null', () => {
    const group = groups.create('G');
    expect(groups.getProxyPool(group.id)).toEqual([]);
    expect(groups.pickNextPoolProxy(group.id)).toBeNull();
  });

  it('setProxyPool stores the pool in the given order and getProxyPool returns it back', () => {
    const group = groups.create('G');
    const a = makeProxy('a');
    const b = makeProxy('b');
    groups.setProxyPool(group.id, [b.id, a.id]);
    expect(groups.getProxyPool(group.id)).toEqual([b.id, a.id]);
  });

  it('setProxyPool fully replaces a previous pool, not merges with it', () => {
    const group = groups.create('G');
    const a = makeProxy('a');
    const b = makeProxy('b');
    groups.setProxyPool(group.id, [a.id, b.id]);
    groups.setProxyPool(group.id, [b.id]);
    expect(groups.getProxyPool(group.id)).toEqual([b.id]);
  });

  it('pickNextPoolProxy round-robins through the pool and wraps around', () => {
    const group = groups.create('G');
    const a = makeProxy('a');
    const b = makeProxy('b');
    const c = makeProxy('c');
    groups.setProxyPool(group.id, [a.id, b.id, c.id]);

    expect(groups.pickNextPoolProxy(group.id)).toBe(a.id);
    expect(groups.pickNextPoolProxy(group.id)).toBe(b.id);
    expect(groups.pickNextPoolProxy(group.id)).toBe(c.id);
    expect(groups.pickNextPoolProxy(group.id)).toBe(a.id); // wraps
  });

  it('a pool of size 1 always returns the same proxy without erroring on the modulo', () => {
    const group = groups.create('G');
    const a = makeProxy('a');
    groups.setProxyPool(group.id, [a.id]);
    expect(groups.pickNextPoolProxy(group.id)).toBe(a.id);
    expect(groups.pickNextPoolProxy(group.id)).toBe(a.id);
  });
});

describe('ProfileManager.start() proxy rotation integration', () => {
  let db: Database.Database;
  let root: string;
  let manager: InstanceType<typeof ProfileManager>;
  let profiles: ProfileRepository;
  let fingerprints: FingerprintRepository;
  let proxies: ProxyRepository;
  let groups: GroupRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    (process.versions as Record<string, string>).chrome = '128.0.0.0';
    db = createTestDb(migrationsDir);
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-rotation-'));
    profiles = new ProfileRepository(db);
    fingerprints = new FingerprintRepository(db);
    proxies = new ProxyRepository(db);
    groups = new GroupRepository(db);
    const logs = new ActivityLogRepository(db);
    manager = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:', groups);
  });

  function makeProfile(name: string, groupId: string | null) {
    const fp = fingerprints.create(generateFingerprint({ seed: name }));
    return manager.create({ name, groupId: groupId ?? undefined }, fp.id);
  }

  it("a profile with no proxy of its own and a group with a pool gets one of the pool's proxies launched", () => {
    const group = groups.create('G');
    const a = proxies.create({ name: 'a', protocol: 'http', host: '127.0.0.1', port: 8080 });
    groups.setProxyPool(group.id, [a.id]);
    const profile = makeProfile('Rotated', group.id);

    manager.start(profile.id);

    const call = vi.mocked(launchProfileProcess).mock.calls[0]![0];
    expect(call.proxy?.id).toBe(a.id);
  });

  it("a profile's own direct proxy assignment always wins over the group's pool", () => {
    const group = groups.create('G');
    const pooled = proxies.create({ name: 'pooled', protocol: 'http', host: '127.0.0.1', port: 8080 });
    const direct = proxies.create({ name: 'direct', protocol: 'http', host: '127.0.0.1', port: 8081 });
    groups.setProxyPool(group.id, [pooled.id]);
    const fp = fingerprints.create(generateFingerprint({ seed: 'Direct Wins' }));
    const profile = manager.create({ name: 'Direct Wins', groupId: group.id, proxyId: direct.id }, fp.id);

    manager.start(profile.id);

    const call = vi.mocked(launchProfileProcess).mock.calls[0]![0];
    expect(call.proxy?.id).toBe(direct.id);
  });

  it('a profile with no group and no proxy launches unproxied, same as before rotation existed', () => {
    const profile = makeProfile('No Group', null);
    manager.start(profile.id);
    const call = vi.mocked(launchProfileProcess).mock.calls[0]![0];
    expect(call.proxy).toBeNull();
  });

  it('when ProfileManager is constructed without a GroupRepository, a grouped-but-proxy-less profile still launches unproxied instead of throwing', () => {
    const logs = new ActivityLogRepository(db);
    const managerNoGroups = new ProfileManager(root, profiles, fingerprints, proxies, logs, ':memory:');
    const group = groups.create('G2');
    const a = proxies.create({ name: 'a2', protocol: 'http', host: '127.0.0.1', port: 8082 });
    groups.setProxyPool(group.id, [a.id]);
    const fp = fingerprints.create(generateFingerprint({ seed: 'No Groups Dep' }));
    const profile = managerNoGroups.create({ name: 'No Groups Dep', groupId: group.id }, fp.id);

    managerNoGroups.start(profile.id);

    const call = vi.mocked(launchProfileProcess).mock.calls[0]![0];
    expect(call.proxy).toBeNull();
  });
});
