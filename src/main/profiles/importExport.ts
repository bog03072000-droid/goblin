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

export interface ImportResult {
  created: Profile[];
  errors: Array<{ path: string; message: string }>;
}

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

    const destRoot = this.writeFullExport(profile, manifest, result.filePaths[0]!);
    this.logs.record('PROFILE_EXPORTED', profileId, `Exported full profile "${profile.name}" to ${destRoot}`);
    return destRoot;
  }

  private writeFullExport(profile: Profile, manifest: ProfileExport, destParent: string): string {
    const destRoot = path.join(destParent, `${profile.name}-export-${Date.now()}`);
    fs.mkdirSync(destRoot, { recursive: true });
    fs.writeFileSync(path.join(destRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
    fs.cpSync(path.join(profile.profilePath, 'browser-data'), path.join(destRoot, 'browser-data'), {
      recursive: true,
    });
    return destRoot;
  }

  /** Bulk config export: one JSON file per selected profile into one chosen folder. */
  async exportSelected(profileIds: string[]): Promise<string | null> {
    if (profileIds.length === 0) return null;
    const result = await dialog.showOpenDialog({
      title: `Choose destination folder for ${profileIds.length} profile(s)`,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const destDir = result.filePaths[0]!;
    for (const id of profileIds) {
      const profile = this.profiles.getById(id);
      if (!profile) continue;
      const manifest = this.buildManifest(profile, 'config');
      const safeName = profile.name.replace(/[\\/:*?"<>|]/g, '_');
      fs.writeFileSync(path.join(destDir, `${safeName}-config.json`), JSON.stringify(manifest, null, 2), 'utf-8');
      this.logs.record('PROFILE_EXPORTED', id, `Exported config for "${profile.name}" (bulk)`);
    }
    return destDir;
  }

  async exportAll(): Promise<string | null> {
    return this.exportSelected(this.profiles.list().map((p) => p.id));
  }

  /** One-click backup: full export (config + browser-data) written automatically
   * under the app's own userData/backups directory — no dialog, no manual
   * destination choice, so it's fast enough to use routinely. */
  async backupProfile(profileId: string): Promise<string> {
    const profile = this.mustGet(profileId);
    const manifest = this.buildManifest(profile, 'full');
    const backupsRoot = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(backupsRoot, { recursive: true });
    const destRoot = this.writeFullExport(profile, manifest, backupsRoot);
    this.logs.record('PROFILE_BACKUP', profileId, `Backed up "${profile.name}" to ${destRoot}`);
    return destRoot;
  }

  /** Restore = import from a backup folder. Per project rule, this never
   * overwrites the original profile — it always creates a new, independent
   * one, defaulting the picker to this app's own backups directory. */
  async restoreProfile(): Promise<Profile | null> {
    const backupsRoot = path.join(app.getPath('userData'), 'backups');
    fs.mkdirSync(backupsRoot, { recursive: true });
    const result = await dialog.showOpenDialog({
      title: 'Restore Profile From Backup',
      defaultPath: backupsRoot,
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const importResult = await this.importFromPaths(result.filePaths);
    const restored = importResult.created[0];
    if (restored) {
      this.logs.record('PROFILE_RESTORE', restored.id, `Restored "${restored.name}" from backup`);
    }
    if (importResult.errors.length > 0) {
      throw new Error(importResult.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
    }
    return restored ?? null;
  }

  /** Opens a native picker (files and/or folders, multi-select) and creates a
   * brand-new profile per valid entry. Each entry is handled independently —
   * one invalid/corrupt file does not abort the rest of the batch. Imported
   * data is validated with Zod before anything is written, and always lands
   * in a freshly generated profile id/directory — it never overwrites an
   * existing profile, and a name collision gets a numbered suffix rather than
   * silently colliding. */
  async importProfiles(): Promise<ImportResult> {
    const result = await dialog.showOpenDialog({
      title: 'Import Profile(s)',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'ProfileForge Export', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { created: [], errors: [] };
    return this.importFromPaths(result.filePaths);
  }

  /** Not private: exercised directly by tests so they don't need to mock the
   * native file dialog — still only reachable from trusted main-process code. */
  async importFromPaths(paths: string[]): Promise<ImportResult> {
    const created: Profile[] = [];
    const errors: Array<{ path: string; message: string }> = [];

    for (const selected of paths) {
      try {
        created.push(this.importOne(selected));
      } catch (err) {
        errors.push({ path: selected, message: err instanceof Error ? err.message : String(err) });
      }
    }
    return { created, errors };
  }

  private importOne(selected: string): Profile {
    const stat = fs.statSync(selected);
    const isFull = stat.isDirectory();
    const manifestPath = isFull ? path.join(selected, 'manifest.json') : selected;
    if (!fs.existsSync(manifestPath)) {
      throw new Error(isFull ? 'Folder does not contain a manifest.json' : 'File not found');
    }

    const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    const manifest = ProfileExportSchema.parse(raw);

    let proxyId: string | null = null;
    if (manifest.proxy) {
      const createdProxy = this.proxies.create({ ...manifest.proxy, password: undefined });
      proxyId = createdProxy.id;
    }

    const fingerprint = this.fingerprints.create(manifest.fingerprint);
    const created = this.profileManager.create(
      {
        name: this.uniqueImportedName(manifest.profile.name),
        description: manifest.profile.description,
        proxyId,
        tags: manifest.profile.tags,
      },
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

  /** Never collides with an existing name — appends " (imported)", then
   * " (imported 2)", " (imported 3)", ... until it finds a free one. */
  private uniqueImportedName(baseName: string): string {
    const existingNames = new Set(this.profiles.list().map((p) => p.name));
    let candidate = `${baseName} (imported)`;
    let n = 2;
    while (existingNames.has(candidate)) {
      candidate = `${baseName} (imported ${n})`;
      n += 1;
    }
    return candidate;
  }

  private mustGet(id: string): Profile {
    const profile = this.profiles.getById(id);
    if (!profile) throw new Error(`Profile not found: ${id}`);
    return profile;
  }
}
