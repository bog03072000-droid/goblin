import { ipcMain, shell } from 'electron';
import fs from 'node:fs';
import { log } from '../logger';
import { IpcRequestSchemas, type IpcChannel } from '../../shared/ipc/contracts';
import type { ProfileManager } from '../profiles/profileManager';
import type { ProfileRepository } from '../database/profileRepository';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import type { ProxyRepository } from '../database/proxyRepository';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import type { TemplateRepository } from '../database/templateRepository';
import type { SettingsRepository } from '../database/settingsRepository';
import type { GroupRepository } from '../database/groupRepository';
import type { DownloadRepository } from '../database/downloadRepository';
import type { ImportExportService } from '../profiles/importExport';
import type { DownloadWithStatus } from '../../shared/schemas/download';
import { generateFingerprint } from '../fingerprint/generator';
import { validateFingerprint } from '../fingerprint/validator';
import { testProxyConnection } from '../proxy/proxyTester';

export interface IpcDependencies {
  profileManager: ProfileManager;
  profiles: ProfileRepository;
  fingerprints: FingerprintRepository;
  proxies: ProxyRepository;
  logs: ActivityLogRepository;
  templates: TemplateRepository;
  importExport: ImportExportService;
  settings: SettingsRepository;
  groups: GroupRepository;
  downloads: DownloadRepository;
}

/** Registers every IPC handler with Zod validation on the incoming payload —
 * renderer input is never trusted, regardless of what the preload API implies. */
export function registerIpc(deps: IpcDependencies): void {
  function handle<C extends IpcChannel>(
    channel: C,
    fn: (payload: ReturnType<(typeof IpcRequestSchemas)[C]['parse']>) => unknown,
  ): void {
    ipcMain.handle(channel, async (_event, rawPayload: unknown) => {
      try {
        const schema = IpcRequestSchemas[channel];
        const payload = schema.parse(rawPayload);
        return await fn(payload as never);
      } catch (err) {
        // Logged here, centrally, before the error is rethrown so it still
        // reaches the renderer as a rejection exactly as before — this only
        // adds a durable record for debugging a packaged build. The raw
        // payload is never logged: several channels (proxy:create/update)
        // carry a plaintext password field the renderer sends on submit.
        log.error(`[ipc:${channel}]`, err);
        throw err;
      }
    });
  }

  handle('profiles:list', (p) => deps.profiles.list(p));
  handle('profiles:get', (p) => deps.profiles.getById(p.id));
  handle('profiles:create', (p) => {
    const template = p.templateId ? deps.templates.getById(p.templateId) : null;
    const fingerprint = deps.fingerprints.create(
      generateFingerprint({
        seed: p.name + Date.now(),
        os: template?.definition.os,
        locale: template?.definition.locale,
      }),
    );
    return deps.profileManager.create(p, fingerprint.id);
  });
  handle('profiles:update', (p) => deps.profiles.update(p.id, p));
  handle('profiles:delete', (p) => deps.profileManager.delete(p.id));
  handle('profiles:start', (p) => deps.profileManager.start(p.id));
  handle('profiles:stop', (p) => deps.profileManager.stop(p.id));
  handle('profiles:restart', (p) => deps.profileManager.restart(p.id));
  handle('profiles:clone', (p) => deps.profileManager.clone(p.id, p.mode, p.name));
  handle('profiles:clearCache', (p) => deps.profileManager.clearCache(p.id));

  handle('fingerprint:get', (p) => deps.fingerprints.getById(p.id));
  handle('fingerprint:generate', (p) => generateFingerprint({ seed: p.seed }));
  handle('fingerprint:validate', (p) => validateFingerprint(p));
  handle('fingerprint:update', (p) => deps.fingerprints.update(p.id, p));

  handle('proxy:list', () => deps.proxies.list());
  handle('proxy:create', (p) => deps.proxies.create(p));
  handle('proxy:update', (p) => deps.proxies.update(p.id, p));
  handle('proxy:delete', (p) => deps.proxies.delete(p.id));
  handle('proxy:test', async (p) => {
    const proxy = deps.proxies.getById(p.id);
    if (!proxy) throw new Error('Proxy not found');
    const password = deps.proxies.getPassword(p.id);
    return testProxyConnection(proxy, password);
  });

  handle('logs:list', (p) => deps.logs.list(p.limit));

  handle('templates:list', () => deps.templates.list());

  handle('profiles:exportConfig', (p) => deps.importExport.exportConfig(p.id));
  handle('profiles:exportFull', (p) => deps.importExport.exportFull(p.id));
  handle('profiles:exportSelected', (p) => deps.importExport.exportSelected(p.ids));
  handle('profiles:exportAll', () => deps.importExport.exportAll());
  handle('profiles:import', () => deps.importExport.importProfiles());
  handle('profiles:backup', (p) => deps.importExport.backupProfile(p.id));
  handle('profiles:restore', () => deps.importExport.restoreProfile());

  handle('profiles:bulkStart', (p) => {
    const concurrency = deps.settings.getAll().maxConcurrentLaunches;
    return deps.profileManager.bulkStart(p.ids, concurrency);
  });
  handle('profiles:bulkStop', (p) => deps.profileManager.bulkStop(p.ids));
  handle('profiles:bulkRestart', (p) => {
    const concurrency = deps.settings.getAll().maxConcurrentLaunches;
    return deps.profileManager.bulkRestart(p.ids, concurrency);
  });
  handle('profiles:bulkDelete', (p) => deps.profileManager.bulkDelete(p.ids));
  handle('profiles:bulkClone', (p) => deps.profileManager.bulkClone(p.ids));
  handle('profiles:bulkBackup', (p) => deps.importExport.bulkBackup(p.ids));
  handle('profiles:bulkAssignProxy', (p) => deps.profileManager.bulkAssignProxy(p.ids, p.proxyId));
  handle('profiles:bulkAddTags', (p) => deps.profileManager.bulkAddTags(p.ids, p.tags));
  handle('profiles:bulkRemoveTags', (p) => deps.profileManager.bulkRemoveTags(p.ids, p.tags));
  handle('profiles:bulkAssignGroup', (p) => deps.profileManager.bulkAssignGroup(p.ids, p.groupId));

  handle('groups:list', () => deps.groups.list());
  handle('groups:create', (p) => deps.groups.create(p.name));
  handle('groups:rename', (p) => deps.groups.rename(p.id, p.name));
  handle('groups:delete', (p) => deps.groups.delete(p.id));

  handle('settings:get', () => deps.settings.getAll());
  handle('settings:update', (p) => deps.settings.update(p));

  // `missing`/`profileName` are computed here rather than stored, so a
  // profile rename is always reflected and a file deleted outside the app
  // is detected on the very next list() call, never a stale cached flag.
  handle('downloads:list', (p) =>
    deps.downloads.list(p).map(
      (d): DownloadWithStatus => ({
        ...d,
        missing: d.state === 'completed' && !fs.existsSync(d.savePath),
        profileName: deps.profiles.getById(d.profileId)?.name ?? '(deleted profile)',
      }),
    ),
  );
  handle('downloads:delete', (p) => deps.downloads.delete(p.id));
  handle('downloads:open', (p) => {
    const record = deps.downloads.getById(p.id);
    if (!record) throw new Error('Download not found');
    void shell.openPath(record.savePath);
  });
  handle('downloads:showInFolder', (p) => {
    const record = deps.downloads.getById(p.id);
    if (!record) throw new Error('Download not found');
    shell.showItemInFolder(record.savePath);
  });
  handle('downloads:redownload', (p) => {
    const record = deps.downloads.getById(p.id);
    if (!record) throw new Error('Download not found');
    return deps.profileManager.start(record.profileId, { initialUrl: record.url });
  });
}
