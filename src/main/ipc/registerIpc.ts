import { ipcMain } from 'electron';
import { IpcRequestSchemas, type IpcChannel } from '../../shared/ipc/contracts';
import type { ProfileManager } from '../profiles/profileManager';
import type { ProfileRepository } from '../database/profileRepository';
import type { FingerprintRepository } from '../database/fingerprintRepository';
import type { ProxyRepository } from '../database/proxyRepository';
import type { ActivityLogRepository } from '../database/activityLogRepository';
import type { TemplateRepository } from '../database/templateRepository';
import type { SettingsRepository } from '../database/settingsRepository';
import type { ImportExportService } from '../profiles/importExport';
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
}

/** Registers every IPC handler with Zod validation on the incoming payload —
 * renderer input is never trusted, regardless of what the preload API implies. */
export function registerIpc(deps: IpcDependencies): void {
  function handle<C extends IpcChannel>(
    channel: C,
    fn: (payload: ReturnType<(typeof IpcRequestSchemas)[C]['parse']>) => unknown,
  ): void {
    ipcMain.handle(channel, (_event, rawPayload: unknown) => {
      const schema = IpcRequestSchemas[channel];
      const payload = schema.parse(rawPayload);
      return fn(payload as never);
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
  handle('profiles:import', () => deps.importExport.importProfile());

  handle('settings:get', () => deps.settings.getAll());
  handle('settings:update', (p) => deps.settings.update(p));
}
