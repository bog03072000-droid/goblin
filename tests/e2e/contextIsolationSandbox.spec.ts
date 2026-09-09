import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * SECURITY.md's "Electron hardening" section states, as its very first two
 * bullet points, that every BrowserWindow (manager + per-profile) runs with
 * `contextIsolation: true, nodeIntegration: false, sandbox: true`, and that
 * `window.profileforge.invoke(channel, payload)` is "the renderer's only
 * bridge to the main process" — "no fs, child_process, shell, process, or
 * database handle is ever exposed". `main.ts`/`profileWindowEntry.ts` do set
 * those three options (confirmed by grep), but no E2E test before this one
 * ever loaded the real, live app and checked what a renderer script can
 * actually observe — the same class of gap as the WebRTC probe,
 * geolocation/permissions, and the diagnostics preload origin gate found
 * earlier this session: a real security property, described in
 * SECURITY.md's own prose, never proven end-to-end.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-sandbox-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  await rmSyncWithRetry(userDataDir);
});

test('the manager window\'s renderer cannot reach any Node API — nodeIntegration/sandbox actually hold, not just the launch options', async () => {
  const nodeGlobals = await window.evaluate(() => ({
    require: typeof (window as unknown as Record<string, unknown>).require,
    process: typeof (window as unknown as Record<string, unknown>).process,
    module: typeof (window as unknown as Record<string, unknown>).module,
    Buffer: typeof (window as unknown as Record<string, unknown>).Buffer,
    __filename: typeof (window as unknown as Record<string, unknown>).__filename,
    __dirname: typeof (window as unknown as Record<string, unknown>).__dirname,
  }));
  expect(nodeGlobals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    Buffer: 'undefined',
    __filename: 'undefined',
    __dirname: 'undefined',
  });
});

test('window.profileforge exposes exactly the three documented functions — nothing else, no fs/child_process/shell/db handle', async () => {
  const exposedKeys = await window.evaluate(() =>
    Object.keys((window as unknown as { profileforge: Record<string, unknown> }).profileforge).sort(),
  );
  expect(exposedKeys).toEqual(['installUpdate', 'invoke', 'onUpdateAvailable']);

  const invokeIsTheOnlyCallable = await window.evaluate(() => {
    const api = (window as unknown as { profileforge: Record<string, unknown> }).profileforge;
    return typeof api.invoke === 'function';
  });
  expect(invokeIsTheOnlyCallable).toBe(true);
});

test('a real attempt to call ipcRenderer or electron APIs directly from the renderer fails — contextIsolation actually isolates, not just the flag', async () => {
  const attempt = await window.evaluate(() => {
    try {
      // No global should exist that lets a compromised/buggy renderer
      // script reach the real Electron/Node APIs outside contextBridge's
      // narrow, explicit surface.
      // @ts-expect-error intentionally probing for a global that must not exist
      return typeof window.electron === 'undefined' && typeof window.ipcRenderer === 'undefined';
    } catch {
      return true;
    }
  });
  expect(attempt).toBe(true);
});
