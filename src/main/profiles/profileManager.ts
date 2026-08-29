import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ProfileRepository } from '../database/profileRepository';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import type { ProxyRepository } from '../database/proxyRepository';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import { LockManager } from './lockManager';
import { launchProfileProcess } from '../browser/browserLauncher';
import { checkBrowserCompatibility } from '../fingerprint/browserCompatibility';
import {
  createProfileStorage,
  deleteProfileStorage,
  clearProfileCache,
  copyProfileStorage,
  resolveProfileDir,
} from '../storage/profileStorage';
import type { Profile, ProfileCreateInput } from '../../shared/schemas/profile';

/**
 * Orchestrates the full profile lifecycle: DB state + on-disk storage + OS
 * process + lock file all move together so they never drift out of sync.
 */
export class ProfileManager {
  private readonly running = new Map<string, ChildProcess>();
  private readonly lockManager = new LockManager();

  constructor(
    private readonly profilesRoot: string,
    private readonly profiles: ProfileRepository,
    private readonly fingerprints: FingerprintRepository,
    private readonly proxies: ProxyRepository,
    private readonly logs: ActivityLogRepository,
  ) {}

  create(input: ProfileCreateInput, fingerprintId: string): Profile {
    // profilePath is computed here, server-side, from a freshly generated ID —
    // never accepted from the caller — so it cannot be used for path traversal.
    const tempProfile = this.profiles.create({
      name: input.name,
      description: input.description,
      profilePath: '__pending__',
      fingerprintId,
      proxyId: input.proxyId ?? null,
      tags: input.tags,
    });
    const dir = createProfileStorage(this.profilesRoot, tempProfile.id);
    this.profiles.setProfilePath(tempProfile.id, dir);
    this.logs.record('PROFILE_CREATED', tempProfile.id, `Profile "${input.name}" created`);
    return this.profiles.getById(tempProfile.id)!;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  start(id: string): Profile {
    const profile = this.mustGet(id);
    if (profile.status === 'RUNNING' || this.running.has(id)) {
      throw new Error('Profile is already running');
    }
    const browserDataDir = path.join(profile.profilePath, 'browser-data');
    if (this.lockManager.isLocked(profile.profilePath)) {
      throw new Error('Profile is locked by another running instance');
    }

    const fingerprint = this.fingerprints.getById(profile.fingerprintId);
    if (!fingerprint) throw new Error('Profile fingerprint is missing');
    const proxy = profile.proxyId ? this.proxies.getById(profile.proxyId) : null;
    const proxyPassword = profile.proxyId ? this.proxies.getPassword(profile.proxyId) : null;

    // Guards against exactly the drift the fingerprint audit found: an
    // Electron/Chromium upgrade silently making an old profile's claimed
    // browser version wrong. Never blocks the launch — just surfaces it.
    const compat = checkBrowserCompatibility(fingerprint.browserVersion, process.versions.chrome);
    if (!compat.compatible && compat.message) {
      this.logs.record('FINGERPRINT_CHANGED', id, compat.message);
    }

    this.profiles.updateStatus(id, 'STARTING');
    let child: ChildProcess;
    try {
      child = launchProfileProcess({
        profileId: id,
        profileName: profile.name,
        userDataDir: browserDataDir,
        fingerprint,
        proxy,
        proxyPassword,
      });
    } catch (err) {
      this.profiles.updateStatus(id, 'ERROR');
      throw err;
    }

    this.lockManager.acquire(profile.profilePath, child.pid ?? -1);
    this.running.set(id, child);
    this.profiles.updateStatus(id, 'RUNNING');
    this.logs.record('PROFILE_STARTED', id, `Profile "${profile.name}" started (pid ${child.pid})`);

    child.on('exit', (code) => {
      this.running.delete(id);
      this.lockManager.release(profile.profilePath);
      const crashed = code !== 0 && code !== null;
      this.profiles.updateStatus(id, crashed ? 'CRASHED' : 'STOPPED');
      this.logs.record(
        crashed ? 'PROFILE_CRASHED' : 'PROFILE_STOPPED',
        id,
        `Profile "${profile.name}" exited with code ${code}`,
      );
    });

    return this.mustGet(id);
  }

  stop(id: string): Profile {
    const profile = this.mustGet(id);
    this.profiles.updateStatus(id, 'STOPPING');
    const child = this.running.get(id);
    if (child) {
      child.kill();
    } else {
      // No tracked process (e.g. app restarted) — just clear stale DB/lock state.
      this.lockManager.release(profile.profilePath);
      this.profiles.updateStatus(id, 'STOPPED');
      this.logs.record('PROFILE_STOPPED', id, `Profile "${profile.name}" stopped (no tracked process)`);
    }
    return this.mustGet(id);
  }

  restart(id: string): Profile {
    if (this.running.has(id) || this.mustGet(id).status === 'RUNNING') {
      this.stop(id);
    }
    return this.start(id);
  }

  clearCache(id: string): void {
    const profile = this.mustGet(id);
    if (this.running.has(id)) throw new Error('Stop the profile before clearing its cache');
    clearProfileCache(this.profilesRoot, id);
    this.logs.record('PROFILE_UPDATED', id, `Cache cleared for "${profile.name}"`);
  }

  delete(id: string): void {
    const profile = this.mustGet(id);
    if (this.running.has(id)) throw new Error('Stop the profile before deleting it');
    deleteProfileStorage(this.profilesRoot, id);
    this.profiles.delete(id);
    this.logs.record('PROFILE_DELETED', id, `Profile "${profile.name}" deleted`);
  }

  /** mode 'config' shares nothing but the fingerprint/proxy config; 'full' also
   * copies the persistent browser-data directory into a fresh, independent path. */
  clone(id: string, mode: 'config' | 'full', newName: string): Profile {
    const source = this.mustGet(id);
    const fingerprint = this.fingerprints.getById(source.fingerprintId);
    if (!fingerprint) throw new Error('Source fingerprint missing');
    const { id: _fpId, createdAt: _fpCreatedAt, updatedAt: _fpUpdatedAt, ...fingerprintInput } = fingerprint;
    const clonedFingerprint = this.fingerprints.create({
      ...fingerprintInput,
      seed: `${fingerprint.seed}-clone-${randomUUID()}`,
    });

    const created = this.create(
      { name: newName, description: source.description, proxyId: source.proxyId, tags: source.tags },
      clonedFingerprint.id,
    );

    if (mode === 'full') {
      copyProfileStorage(this.profilesRoot, source.id, created.id);
    }
    this.logs.record('PROFILE_CLONED', created.id, `Cloned from "${source.name}" (mode: ${mode})`);
    return created;
  }

  private mustGet(id: string): Profile {
    const profile = this.profiles.getById(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    // Guard against forged storage paths pointing outside the managed root.
    resolveProfileDir(this.profilesRoot, id);
    return profile;
  }
}
