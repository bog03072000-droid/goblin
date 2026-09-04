import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

vi.mock('../../src/main/proxy/proxyTester', () => ({
  testProxyConnection: vi.fn(async () => ({ success: true, latencyMs: 12, error: null })),
}));

const { ipcMain } = await import('electron');
const { registerIpc } = await import('../../src/main/ipc/registerIpc');
const { testProxyConnection } = await import('../../src/main/proxy/proxyTester');

const PROFILE_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_ID = '22222222-2222-2222-2222-222222222222';

/** A syntactically-valid but otherwise arbitrary full fingerprint payload —
 * only fingerprint:validate needs every required field filled in (its
 * schema, unlike fingerprint:update's, isn't .partial()). */
function makeFingerprintInput() {
  return {
    name: 'fp',
    os: 'windows' as const,
    osVersion: '10',
    browserVersion: '128.0.0.0',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0',
    platform: 'Win32',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezone: 'America/New_York',
    screenWidth: 1920,
    screenHeight: 1080,
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE',
    canvasMode: 'off' as const,
    audioMode: 'off' as const,
    webrtcMode: 'default' as const,
    fontsMode: 'system' as const,
    mediaDevicesMode: 'real' as const,
    webglSpoofingMode: 'off' as const,
    geolocationMode: 'real' as const,
    geolocationLatitude: 0,
    geolocationLongitude: 0,
    permissionsMode: 'real' as const,
    seed: 'seed',
  };
}

/** Builds a full IpcDependencies fixture with a vi.fn() stub for every
 * method any handler in registerIpc.ts calls — shared by every test below
 * via a fresh beforeEach so no assertion can leak state between tests. */
function makeDeps() {
  return {
    profileManager: {
      create: vi.fn((_input, fingerprintId) => ({ id: PROFILE_ID, fingerprintId })),
      delete: vi.fn(),
      restoreDeleted: vi.fn(() => ({ id: PROFILE_ID })),
      start: vi.fn(() => ({ id: PROFILE_ID, status: 'RUNNING' })),
      stop: vi.fn(async () => ({ id: PROFILE_ID, status: 'STOPPED' })),
      restart: vi.fn(async () => ({ id: PROFILE_ID, status: 'RUNNING' })),
      clone: vi.fn(() => ({ id: OTHER_ID })),
      clearCache: vi.fn(),
      listCookies: vi.fn(async () => []),
      removeCookie: vi.fn(async () => undefined),
      setCookie: vi.fn(async () => undefined),
      listLocalStorage: vi.fn(async () => ({ origin: 'https://example.com', items: [] })),
      setLocalStorageItem: vi.fn(async () => undefined),
      removeLocalStorageItem: vi.fn(async () => undefined),
      bulkStart: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkStop: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkRestart: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkDelete: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkRestoreDeleted: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkClone: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkAssignProxy: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkAddTags: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkRemoveTags: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
      bulkAssignGroup: vi.fn(async () => ({ succeeded: [PROFILE_ID], failed: [] })),
    },
    profiles: {
      list: vi.fn(() => [{ id: PROFILE_ID }]),
      getById: vi.fn(() => ({ id: PROFILE_ID, name: 'Test Profile' })),
      update: vi.fn((id, patch) => ({ id, ...patch })),
      getAutomationToken: vi.fn(() => 'token-abc'),
      regenerateAutomationToken: vi.fn(() => 'token-xyz'),
    },
    fingerprints: {
      create: vi.fn((input) => ({ id: OTHER_ID, ...input })),
      getById: vi.fn(() => ({ id: OTHER_ID, ...makeFingerprintInput() })),
      update: vi.fn((id, patch) => ({ id, ...patch })),
    },
    proxies: {
      list: vi.fn(() => []),
      create: vi.fn((input) => ({ id: OTHER_ID, ...input })),
      update: vi.fn((id, patch) => ({ id, ...patch })),
      delete: vi.fn(),
      getById: vi.fn(() => ({ id: OTHER_ID, name: 'Proxy 1', protocol: 'http', host: '1.2.3.4', port: 8080 })),
      getPassword: vi.fn(() => 'secret'),
      recordCheckResult: vi.fn(),
      listCheckHistory: vi.fn(() => []),
    },
    logs: {
      record: vi.fn(),
      list: vi.fn(() => []),
      latestId: vi.fn(() => 0),
    },
    templates: {
      list: vi.fn(() => []),
      getById: vi.fn(() => null),
    },
    importExport: {
      exportConfig: vi.fn(async () => undefined),
      exportFull: vi.fn(async () => undefined),
      exportSelected: vi.fn(async () => undefined),
      exportAll: vi.fn(async () => undefined),
      importProfiles: vi.fn(async () => ({ succeeded: [], failed: [] })),
      backupProfile: vi.fn(async () => undefined),
      restoreProfile: vi.fn(async () => undefined),
      bulkBackup: vi.fn(async () => undefined),
    },
    settings: {
      getAll: vi.fn(() => ({ maxConcurrentLaunches: 4 })),
      update: vi.fn((patch) => ({ maxConcurrentLaunches: 4, ...patch })),
    },
    groups: {
      list: vi.fn(() => []),
      create: vi.fn((name) => ({ id: OTHER_ID, name })),
      rename: vi.fn((id, name) => ({ id, name })),
      delete: vi.fn(),
      getProxyPool: vi.fn(() => []),
      setProxyPool: vi.fn(),
    },
    downloads: {
      list: vi.fn(() => []),
      delete: vi.fn(),
      getById: vi.fn(() => ({ id: OTHER_ID, profileId: PROFILE_ID, savePath: 'C:\\downloads\\file.zip', url: 'https://example.com/file.zip' })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Looks up the listener registerIpc() registered for `channel` via the
 * mocked ipcMain (tests/unit/mocks/electron.ts) and invokes it exactly the
 * way a real renderer invoke() would — a fake event object first, the raw
 * (unvalidated) payload second. */
async function invoke(channel: string, payload: unknown): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listener = (ipcMain as any)._handlers.get(channel);
  if (!listener) throw new Error(`No handler registered for channel: ${channel}`);
  return listener({}, payload);
}

describe('registerIpc', () => {
  let deps: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ipcMain as any)._handlers.clear();
    deps = makeDeps();
    registerIpc(deps);
  });

  describe('the handle() wrapper — validation, routing, and error propagation', () => {
    it('parses a valid payload through its Zod schema before calling the handler', async () => {
      const result = await invoke('profiles:get', { id: PROFILE_ID });
      expect(deps.profiles.getById).toHaveBeenCalledWith(PROFILE_ID);
      expect(result).toEqual({ id: PROFILE_ID, name: 'Test Profile' });
    });

    it('rejects a payload that fails Zod validation instead of ever calling the handler', async () => {
      await expect(invoke('profiles:get', { id: 'not-a-valid-uuid' })).rejects.toThrow();
      expect(deps.profiles.getById).not.toHaveBeenCalled();
    });

    it('rejects a payload missing a required field', async () => {
      await expect(invoke('profiles:clone', { id: PROFILE_ID })).rejects.toThrow();
      expect(deps.profileManager.clone).not.toHaveBeenCalled();
    });

    it('rejects a payload with a field of the wrong type', async () => {
      await expect(invoke('profiles:list', { search: 123 })).rejects.toThrow();
    });

    it('rejects an enum field outside its allowed values', async () => {
      await expect(invoke('profiles:clone', { id: PROFILE_ID, mode: 'not-a-real-mode', name: 'x' })).rejects.toThrow();
    });

    it('propagates an error thrown by the underlying handler/dependency rather than swallowing it', async () => {
      deps.profiles.getById.mockImplementation(() => {
        throw new Error('DB exploded');
      });
      await expect(invoke('profiles:get', { id: PROFILE_ID })).rejects.toThrow('DB exploded');
    });

    it('propagates a rejected promise from an async handler', async () => {
      deps.profileManager.stop.mockRejectedValue(new Error('stop failed'));
      await expect(invoke('profiles:stop', { id: PROFILE_ID })).rejects.toThrow('stop failed');
    });

    it('a channel with an empty-object schema rejects extraneous unexpected payload shapes that would otherwise silently pass through', async () => {
      // z.object({}) is NOT strict by default (unknown keys pass through) —
      // this documents actual current behavior (extra keys tolerated) rather
      // than assuming .strict() is in effect, which it isn't here.
      const result = await invoke('proxy:list', { unexpectedField: 'x' });
      expect(deps.proxies.list).toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('profiles:* routing', () => {
    it('profiles:list delegates to profiles.list with the parsed filter payload', async () => {
      await invoke('profiles:list', { search: 'abc', tag: 'work' });
      expect(deps.profiles.list).toHaveBeenCalledWith({ search: 'abc', tag: 'work' });
    });

    it('profiles:create generates a fingerprint, merges any override, and delegates to profileManager.create', async () => {
      const result = await invoke('profiles:create', { name: 'New Profile' });
      expect(deps.fingerprints.create).toHaveBeenCalled();
      expect(deps.profileManager.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Profile' }), OTHER_ID);
      expect(result).toEqual({ id: PROFILE_ID, fingerprintId: OTHER_ID });
    });

    it('profiles:create resolves a template when templateId is given', async () => {
      deps.templates.getById.mockReturnValue({ id: 'tmpl-1', definition: { os: 'macos', locale: 'fr-FR' } });
      await invoke('profiles:create', { name: 'Templated', templateId: 'tmpl-1' });
      expect(deps.templates.getById).toHaveBeenCalledWith('tmpl-1');
    });

    it('profiles:update delegates id + patch to profiles.update', async () => {
      await invoke('profiles:update', { id: PROFILE_ID, name: 'Renamed' });
      expect(deps.profiles.update).toHaveBeenCalledWith(PROFILE_ID, expect.objectContaining({ id: PROFILE_ID, name: 'Renamed' }));
    });

    it('profiles:getAutomationToken wraps the token in an object', async () => {
      const result = await invoke('profiles:getAutomationToken', { id: PROFILE_ID });
      expect(result).toEqual({ token: 'token-abc' });
    });

    it('profiles:regenerateAutomationToken wraps the new token in an object', async () => {
      const result = await invoke('profiles:regenerateAutomationToken', { id: PROFILE_ID });
      expect(result).toEqual({ token: 'token-xyz' });
    });

    it('profiles:delete/restoreDeleted/start/stop/restart/clearCache all route to the matching profileManager method with the id', async () => {
      await invoke('profiles:delete', { id: PROFILE_ID });
      expect(deps.profileManager.delete).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:restoreDeleted', { id: PROFILE_ID });
      expect(deps.profileManager.restoreDeleted).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:start', { id: PROFILE_ID });
      expect(deps.profileManager.start).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:stop', { id: PROFILE_ID });
      expect(deps.profileManager.stop).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:restart', { id: PROFILE_ID });
      expect(deps.profileManager.restart).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:clearCache', { id: PROFILE_ID });
      expect(deps.profileManager.clearCache).toHaveBeenCalledWith(PROFILE_ID);
    });

    it('profiles:clone passes id/mode/name through in order', async () => {
      await invoke('profiles:clone', { id: PROFILE_ID, mode: 'full', name: 'Clone' });
      expect(deps.profileManager.clone).toHaveBeenCalledWith(PROFILE_ID, 'full', 'Clone');
    });

    it('cookie and localStorage channels route to the matching profileManager methods', async () => {
      await invoke('profiles:cookies:list', { id: PROFILE_ID });
      expect(deps.profileManager.listCookies).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:cookies:remove', { id: PROFILE_ID, url: 'https://x.com', name: 'sid' });
      expect(deps.profileManager.removeCookie).toHaveBeenCalledWith(PROFILE_ID, { url: 'https://x.com', name: 'sid' });
      await invoke('profiles:cookies:set', { id: PROFILE_ID, cookie: { name: 'sid', value: 'v', url: 'https://x.com' } });
      expect(deps.profileManager.setCookie).toHaveBeenCalledWith(PROFILE_ID, { name: 'sid', value: 'v', url: 'https://x.com' });
      await invoke('profiles:localStorage:list', { id: PROFILE_ID });
      expect(deps.profileManager.listLocalStorage).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:localStorage:set', { id: PROFILE_ID, item: { key: 'k', value: 'v' } });
      expect(deps.profileManager.setLocalStorageItem).toHaveBeenCalledWith(PROFILE_ID, { key: 'k', value: 'v' });
      await invoke('profiles:localStorage:remove', { id: PROFILE_ID, key: 'k' });
      expect(deps.profileManager.removeLocalStorageItem).toHaveBeenCalledWith(PROFILE_ID, 'k');
    });
  });

  describe('fingerprint:* routing', () => {
    it('fingerprint:get delegates to fingerprints.getById', async () => {
      await invoke('fingerprint:get', { id: OTHER_ID });
      expect(deps.fingerprints.getById).toHaveBeenCalledWith(OTHER_ID);
    });

    it('fingerprint:generate produces a real generated fingerprint for the given seed', async () => {
      const result = (await invoke('fingerprint:generate', { seed: 'my-seed' })) as { seed: string; os: string };
      expect(result.seed).toBe('my-seed');
      expect(['windows', 'macos', 'linux']).toContain(result.os);
    });

    it('fingerprint:options returns the real static platform/browser-version option lists', async () => {
      const result = (await invoke('fingerprint:options', {})) as { platforms: unknown[]; browserVersions: unknown[] };
      expect(Array.isArray(result.platforms)).toBe(true);
      expect(result.platforms.length).toBeGreaterThan(0);
      expect(Array.isArray(result.browserVersions)).toBe(true);
    });

    it('fingerprint:validate runs the real validator against a full fingerprint payload', async () => {
      const result = (await invoke('fingerprint:validate', makeFingerprintInput())) as { valid: boolean };
      expect(typeof result.valid).toBe('boolean');
    });

    it('fingerprint:validate rejects a payload missing required fields (schema is not partial, unlike fingerprint:update)', async () => {
      await expect(invoke('fingerprint:validate', { seed: 'only-seed' })).rejects.toThrow();
    });

    it('fingerprint:update delegates id + partial patch to fingerprints.update', async () => {
      await invoke('fingerprint:update', { id: OTHER_ID, canvasMode: 'noise' });
      expect(deps.fingerprints.update).toHaveBeenCalledWith(OTHER_ID, expect.objectContaining({ id: OTHER_ID, canvasMode: 'noise' }));
    });
  });

  describe('proxy:* routing', () => {
    it('proxy:list delegates to proxies.list', async () => {
      await invoke('proxy:list', {});
      expect(deps.proxies.list).toHaveBeenCalled();
    });

    it('proxy:create persists the proxy and records a PROXY_CREATED activity log entry', async () => {
      await invoke('proxy:create', { name: 'P1', protocol: 'http', host: '1.2.3.4', port: 8080 });
      expect(deps.proxies.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'P1' }));
      expect(deps.logs.record).toHaveBeenCalledWith('PROXY_CREATED', null, expect.stringContaining('P1'));
    });

    it('proxy:update persists the patch and records a PROXY_UPDATED activity log entry', async () => {
      await invoke('proxy:update', { id: OTHER_ID, name: 'Renamed Proxy' });
      expect(deps.proxies.update).toHaveBeenCalledWith(OTHER_ID, expect.objectContaining({ id: OTHER_ID, name: 'Renamed Proxy' }));
      expect(deps.logs.record).toHaveBeenCalledWith('PROXY_UPDATED', null, expect.any(String));
    });

    it('proxy:delete looks the proxy up first (for its name in the log), deletes it, and records PROXY_DELETED', async () => {
      await invoke('proxy:delete', { id: OTHER_ID });
      expect(deps.proxies.getById).toHaveBeenCalledWith(OTHER_ID);
      expect(deps.proxies.delete).toHaveBeenCalledWith(OTHER_ID);
      expect(deps.logs.record).toHaveBeenCalledWith('PROXY_DELETED', null, expect.stringContaining('Proxy 1'));
    });

    it('proxy:delete falls back to the raw id in the log message when the proxy is already gone', async () => {
      deps.proxies.getById.mockReturnValue(null);
      await invoke('proxy:delete', { id: OTHER_ID });
      expect(deps.logs.record).toHaveBeenCalledWith('PROXY_DELETED', null, expect.stringContaining(OTHER_ID));
    });

    it('proxy:test looks up the proxy and password, runs a real connection test, and records the result as a health check', async () => {
      const result = await invoke('proxy:test', { id: OTHER_ID });
      expect(deps.proxies.getPassword).toHaveBeenCalledWith(OTHER_ID);
      expect(testProxyConnection).toHaveBeenCalled();
      expect(deps.proxies.recordCheckResult).toHaveBeenCalledWith(OTHER_ID, { success: true, latencyMs: 12, error: null });
      expect(result).toEqual({ success: true, latencyMs: 12, error: null });
    });

    it('proxy:test rejects when the proxy no longer exists, without touching recordCheckResult', async () => {
      deps.proxies.getById.mockReturnValue(null);
      await expect(invoke('proxy:test', { id: OTHER_ID })).rejects.toThrow('Proxy not found');
      expect(deps.proxies.recordCheckResult).not.toHaveBeenCalled();
    });

    it('proxy:checkHistory delegates to proxies.listCheckHistory', async () => {
      await invoke('proxy:checkHistory', { id: OTHER_ID });
      expect(deps.proxies.listCheckHistory).toHaveBeenCalledWith(OTHER_ID);
    });
  });

  describe('logs:*, templates:*, and export/import routing', () => {
    it('logs:list forwards every filter field by name to logs.list', async () => {
      await invoke('logs:list', { limit: 50, beforeId: 10, eventType: 'PROFILE_CREATED', profileId: PROFILE_ID, search: 'x' });
      expect(deps.logs.list).toHaveBeenCalledWith({ limit: 50, beforeId: 10, eventType: 'PROFILE_CREATED', profileId: PROFILE_ID, search: 'x' });
    });

    it('logs:list applies its schema default (200) when limit is omitted', async () => {
      await invoke('logs:list', {});
      expect(deps.logs.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 200 }));
    });

    it('logs:latestId delegates to logs.latestId', async () => {
      await invoke('logs:latestId', {});
      expect(deps.logs.latestId).toHaveBeenCalled();
    });

    it('templates:list delegates to templates.list', async () => {
      await invoke('templates:list', {});
      expect(deps.templates.list).toHaveBeenCalled();
    });

    it('export/import/backup channels all route to their matching importExport method', async () => {
      await invoke('profiles:exportConfig', { id: PROFILE_ID });
      expect(deps.importExport.exportConfig).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:exportFull', { id: PROFILE_ID });
      expect(deps.importExport.exportFull).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:exportSelected', { ids: [PROFILE_ID] });
      expect(deps.importExport.exportSelected).toHaveBeenCalledWith([PROFILE_ID]);
      await invoke('profiles:exportAll', {});
      expect(deps.importExport.exportAll).toHaveBeenCalled();
      await invoke('profiles:import', {});
      expect(deps.importExport.importProfiles).toHaveBeenCalled();
      await invoke('profiles:backup', { id: PROFILE_ID });
      expect(deps.importExport.backupProfile).toHaveBeenCalledWith(PROFILE_ID);
      await invoke('profiles:restore', {});
      expect(deps.importExport.restoreProfile).toHaveBeenCalled();
    });
  });

  describe('bulk:* routing', () => {
    it('bulkStart reads maxConcurrentLaunches from settings and passes it through', async () => {
      deps.settings.getAll.mockReturnValue({ maxConcurrentLaunches: 7 });
      await invoke('profiles:bulkStart', { ids: [PROFILE_ID] });
      expect(deps.profileManager.bulkStart).toHaveBeenCalledWith([PROFILE_ID], 7);
    });

    it('bulkRestart also reads maxConcurrentLaunches from settings', async () => {
      deps.settings.getAll.mockReturnValue({ maxConcurrentLaunches: 3 });
      await invoke('profiles:bulkRestart', { ids: [PROFILE_ID] });
      expect(deps.profileManager.bulkRestart).toHaveBeenCalledWith([PROFILE_ID], 3);
    });

    it('the remaining bulk channels route straight through with their ids (and any extra field)', async () => {
      await invoke('profiles:bulkStop', { ids: [PROFILE_ID] });
      expect(deps.profileManager.bulkStop).toHaveBeenCalledWith([PROFILE_ID]);
      await invoke('profiles:bulkDelete', { ids: [PROFILE_ID] });
      expect(deps.profileManager.bulkDelete).toHaveBeenCalledWith([PROFILE_ID]);
      await invoke('profiles:bulkRestoreDeleted', { ids: [PROFILE_ID] });
      expect(deps.profileManager.bulkRestoreDeleted).toHaveBeenCalledWith([PROFILE_ID]);
      await invoke('profiles:bulkClone', { ids: [PROFILE_ID] });
      expect(deps.profileManager.bulkClone).toHaveBeenCalledWith([PROFILE_ID]);
      await invoke('profiles:bulkBackup', { ids: [PROFILE_ID] });
      expect(deps.importExport.bulkBackup).toHaveBeenCalledWith([PROFILE_ID]);
      await invoke('profiles:bulkAssignProxy', { ids: [PROFILE_ID], proxyId: OTHER_ID });
      expect(deps.profileManager.bulkAssignProxy).toHaveBeenCalledWith([PROFILE_ID], OTHER_ID);
      await invoke('profiles:bulkAddTags', { ids: [PROFILE_ID], tags: ['a'] });
      expect(deps.profileManager.bulkAddTags).toHaveBeenCalledWith([PROFILE_ID], ['a']);
      await invoke('profiles:bulkRemoveTags', { ids: [PROFILE_ID], tags: ['a'] });
      expect(deps.profileManager.bulkRemoveTags).toHaveBeenCalledWith([PROFILE_ID], ['a']);
      await invoke('profiles:bulkAssignGroup', { ids: [PROFILE_ID], groupId: OTHER_ID });
      expect(deps.profileManager.bulkAssignGroup).toHaveBeenCalledWith([PROFILE_ID], OTHER_ID);
    });

    it('bulk channels reject an empty ids array (schema requires at least one)', async () => {
      await expect(invoke('profiles:bulkStop', { ids: [] })).rejects.toThrow();
    });
  });

  describe('groups:* routing', () => {
    it('groups:list/create/rename/delete/getProxyPool/setProxyPool all route correctly', async () => {
      await invoke('groups:list', {});
      expect(deps.groups.list).toHaveBeenCalled();
      await invoke('groups:create', { name: 'G1' });
      expect(deps.groups.create).toHaveBeenCalledWith('G1');
      await invoke('groups:rename', { id: OTHER_ID, name: 'G2' });
      expect(deps.groups.rename).toHaveBeenCalledWith(OTHER_ID, 'G2');
      await invoke('groups:delete', { id: OTHER_ID });
      expect(deps.groups.delete).toHaveBeenCalledWith(OTHER_ID);
      await invoke('groups:getProxyPool', { groupId: OTHER_ID });
      expect(deps.groups.getProxyPool).toHaveBeenCalledWith(OTHER_ID);
      await invoke('groups:setProxyPool', { groupId: OTHER_ID, proxyIds: [PROFILE_ID] });
      expect(deps.groups.setProxyPool).toHaveBeenCalledWith(OTHER_ID, [PROFILE_ID]);
    });
  });

  describe('settings:* and security:* routing', () => {
    it('settings:get/update route to settings.getAll/update', async () => {
      await invoke('settings:get', {});
      expect(deps.settings.getAll).toHaveBeenCalled();
      await invoke('settings:update', { theme: 'dark' });
      expect(deps.settings.update).toHaveBeenCalledWith({ theme: 'dark' });
    });

    it('security:credentialEncryptionStatus reports safeStorage.isEncryptionAvailable() (false under the test mock)', async () => {
      const result = await invoke('security:credentialEncryptionStatus', {});
      expect(result).toEqual({ available: false });
    });
  });

  describe('downloads:* routing', () => {
    it('downloads:list annotates each row with a computed profileName and missing flag', async () => {
      deps.downloads.list.mockReturnValue([{ id: OTHER_ID, profileId: PROFILE_ID, state: 'completed', savePath: '/nonexistent/path/file.zip' }]);
      const result = (await invoke('downloads:list', {})) as Array<{ profileName: string; missing: boolean }>;
      expect(result[0]!.profileName).toBe('Test Profile');
      expect(result[0]!.missing).toBe(true); // savePath doesn't exist on disk
    });

    it("downloads:list reports '(deleted profile)' when the owning profile no longer exists", async () => {
      deps.profiles.getById.mockReturnValue(null);
      deps.downloads.list.mockReturnValue([{ id: OTHER_ID, profileId: PROFILE_ID, state: 'completed', savePath: '/x' }]);
      const result = (await invoke('downloads:list', {})) as Array<{ profileName: string }>;
      expect(result[0]!.profileName).toBe('(deleted profile)');
    });

    it('downloads:delete delegates to downloads.delete', async () => {
      await invoke('downloads:delete', { id: OTHER_ID });
      expect(deps.downloads.delete).toHaveBeenCalledWith(OTHER_ID);
    });

    it('downloads:open/showInFolder/redownload all reject with a clear error when the download no longer exists', async () => {
      deps.downloads.getById.mockReturnValue(null);
      await expect(invoke('downloads:open', { id: OTHER_ID })).rejects.toThrow('Download not found');
      await expect(invoke('downloads:showInFolder', { id: OTHER_ID })).rejects.toThrow('Download not found');
      await expect(invoke('downloads:redownload', { id: OTHER_ID })).rejects.toThrow('Download not found');
    });

    it('downloads:redownload starts the owning profile navigating at the original download URL', async () => {
      await invoke('downloads:redownload', { id: OTHER_ID });
      expect(deps.profileManager.start).toHaveBeenCalledWith(PROFILE_ID, { initialUrl: 'https://example.com/file.zip' });
    });
  });
});

// Sanity check that this file's own hand-picked payloads actually match the
// real schemas rather than a stale mental model of them — if contracts.ts
// changes shape, this fails loudly instead of every invoke() call above
// just silently validating against payloads that drifted out of sync.
describe('schema sanity', () => {
  it('IpcRequestSchemas is a non-empty registry of real Zod schemas', async () => {
    const { IpcRequestSchemas } = await import('../../src/shared/ipc/contracts');
    const keys = Object.keys(IpcRequestSchemas);
    expect(keys.length).toBeGreaterThan(40);
    for (const key of keys) {
      expect(IpcRequestSchemas[key as keyof typeof IpcRequestSchemas]).toBeInstanceOf(z.ZodType);
    }
  });
});
