import { app, dialog } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ProfileRepository } from '../database/profileRepository';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import type { ProxyRepository } from '../database/proxyRepository';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import type { ProfileManager } from './profileManager';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ProfileExportSchema,
  type ProfileExport,
} from '../../shared/schemas/exportFormat';
import type { Profile } from '../../shared/schemas/profile';

/**
 * Export/import always goes through a native OS dialog for the destination —
 * the renderer never supplies a raw filesystem path here, only a profile id.
 * The user's own dialog selection is the trust boundary, same as any desktop app.
 */
export class ImportExportService {
  constructor(
    private readonly profiles: ProfileRepository,
    private readonly fingerprints: FingerprintRepository,
    private readonly proxies: ProxyRepository,
    private readonly logs: ActivityLogRepository,
    private readonly profileManager: ProfileManager,
  ) {}

  private buildManifest(profile: Profile, mode: 'config' | 'full'): ProfileExport {
    const fingerprint = this.fingerprints.getById(profile.fingerprintId);
    if (!fingerprint) throw new Error('Profile fingerprint missing');
    const proxy = profile.proxyId ? this.proxies.getById(profile.proxyId) : null;

    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      mode,
      profile: { name: profile.name, description: profile.description, tags: profile.tags },
      fingerprint: {
        name: fingerprint.name,
        os: fingerprint.os,
        osVersion: fingerprint.osVersion,
        browserVersion: fingerprint.browserVersion,
        userAgent: fingerprint.userAgent,
        platform: fingerprint.platform,
        locale: fingerprint.locale,
        languages: fingerprint.languages,
        timezone: fingerprint.timezone,
        screenWidth: fingerprint.screenWidth,
        screenHeight: fingerprint.screenHeight,
        deviceScaleFactor: fingerprint.deviceScaleFactor,
        hardwareConcurrency: fingerprint.hardwareConcurrency,
        deviceMemory: fingerprint.deviceMemory,
        webglVendor: fingerprint.webglVendor,
        webglRenderer: fingerprint.webglRenderer,
        canvasMode: fingerprint.canvasMode,
        audioMode: fingerprint.audioMode,
        webrtcMode: fingerprint.webrtcMode,
        fontsMode: fingerprint.fontsMode,
        mediaDevicesMode: fingerprint.mediaDevicesMode,
        seed: fingerprint.seed,
      },
      // Password is never included in an export, by design (see SECURITY.md).
      proxy: proxy
        ? { name: proxy.name, protocol: proxy.protocol, host: proxy.host, port: proxy.port, username: proxy.username }
        : null,
      metadata: { exportedAt: new Date().toISOString(), sourceAppVersion: app.getVersion() },
    };
  }

  /** Writes a single JSON manifest with no browser-data. Returns the chosen path, or null if cancelled. */
  async exportConfig(profileId: string): Promise<string | null> {
    const profile = this.mustGet(profileId);
    const manifest = this.buildManifest(profile, 'config');

    const result = await dialog.showSaveDialog({
      title: 'Export Profile Configuration',
      defaultPath: `${profile.name}-config.json`,
      filters: [{ name: 'ProfileForge Export', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;

    fs.writeFileSync(result.filePath, JSON.stringify(manifest, null, 2), 'utf-8');
    this.logs.record('PROFILE_EXPORTED', profileId, `Exported config for "${profile.name}"`);
    return result.filePath;
  }

  /** Writes manifest.json + a copy of browser-data into a user-chosen folder.
   * Not a single portable archive file — see docs/DEVELOPMENT.md for why (no
   * zip/tar dependency was added speculatively; documented rather than faked). */
  async exportFull(profileId: string): Promise<string | null> {
    const profile = this.mustGet(profileId);
    const manifest = this.buildManifest(profile, 'full');

    const result = await dialog.showOpenDialog({
      title: 'Choose destination folder for full profile export',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const destRoot = path.join(result.filePaths[0]!, `${profile.name}-export`);
    fs.mkdirSync(destRoot, { recursive: true });
    fs.writeFileSync(path.join(destRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    fs.cpSync(path.join(profile.profilePath, 'browser-data'), path.join(destRoot, 'browser-data'), {
      recursive: true,
    });

    this.logs.record('PROFILE_EXPORTED', profileId, `Exported full profile "${profile.name}" to ${destRoot}`);
    return destRoot;
  }

  /** Opens a native picker (file for config export, folder for full export) and
   * creates a brand-new profile from it. Imported data is validated with Zod
   * before anything is written, and always lands in a freshly generated
   * profile id/directory — it never overwrites an existing profile. */
  async importProfile(): Promise<Profile | null> {
    const result = await dialog.showOpenDialog({
      title: 'Import Profile',
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'ProfileForge Export', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const selected = result.filePaths[0]!;
    const stat = fs.statSync(selected);
    const isFull = stat.isDirectory();
    const manifestPath = isFull ? path.join(selected, 'manifest.json') : selected;

    const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const manifest = ProfileExportSchema.parse(raw);

    let proxyId: string | null = null;
    if (manifest.proxy) {
      const createdProxy = this.proxies.create({ ...manifest.proxy, password: undefined });
      proxyId = createdProxy.id;
    }

    const fingerprint = this.fingerprints.create(manifest.fingerprint);
    const created = this.profileManager.create(
      { name: `${manifest.profile.name} (imported)`, description: manifest.profile.description, proxyId, tags: manifest.profile.tags },
      fingerprint.id,
    );

    if (isFull) {
      const importedBrowserData = path.join(selected, 'browser-data');
      if (fs.existsSync(importedBrowserData)) {
        fs.rmSync(path.join(created.profilePath, 'browser-data'), { recursive: true, force: true });
        fs.cpSync(importedBrowserData, path.join(created.profilePath, 'browser-data'), { recursive: true });
      }
    }

    this.logs.record('PROFILE_IMPORTED', created.id, `Imported profile as "${created.name}"`);
    return created;
  }

  private mustGet(id: string): Profile {
    const profile = this.profiles.getById(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    return profile;
  }
}
