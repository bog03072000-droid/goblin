import { app, BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'node:path';
import { log } from './logger';
import { getDb } from './database/db';
import { ProfileRepository } from './database/profileRepository';
import { FingerprintRepository } from './database/fingerprintRepository';
import { ProxyRepository } from './database/proxyRepository';
import { ActivityLogRepository } from './database/activityLogRepository';
import { TemplateRepository } from './database/templateRepository';
import { SettingsRepository } from './database/settingsRepository';
import { GroupRepository } from './database/groupRepository';
import { DownloadRepository } from './database/downloadRepository';
import { ProfileManager } from './profiles/profileManager';
import { ImportExportService } from './profiles/importExport';
import { ProxyHealthScheduler } from './proxy/proxyHealthScheduler';
import { registerIpc } from './ipc/registerIpc';
import { runProfileWindowProcess } from './browser/profileWindowEntry';

// Last-resort safety net: without these, an uncaught error in either process
// role would otherwise only ever appear in a console nobody is watching in a
// packaged build, with no record left behind to debug from afterwards.
// uncaughtException still exits after logging — Node's own default behavior
// for an unhandled exception is to crash immediately, and merely attaching a
// listener suppresses that (the process would otherwise stay alive in a
// possibly-corrupted state, e.g. having failed before app.whenReady() ever
// ran, with no window and no way to recover). This only adds a durable
// record on the way out, it does not change whether the process survives.
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException]', err);
  app.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('[unhandledRejection]', reason);
});

// This same compiled entry point is used for both the manager app and every
// per-profile child process (see browserLauncher.ts) — the flag decides which
// role this OS process plays.
if (process.argv.includes('--profile-window')) {
  runProfileWindowProcess();
} else {
  runManagerProcess();
}

function runManagerProcess(): void {
  const userDataDir = app.getPath('userData');
  const dbPath = path.join(userDataDir, 'profileforge.db');
  const profilesRoot = path.join(userDataDir, 'profiles');
  const migrationsDir = app.isPackaged
    ? path.join(process.resourcesPath, 'database', 'migrations')
    : path.join(__dirname, '..', '..', 'database', 'migrations');

  // Opened before `ready` (app.getPath works pre-ready) specifically so the
  // hardwareAcceleration setting can take effect — disableHardwareAcceleration()
  // only has an effect if called before the app is ready.
  const db = getDb(dbPath, migrationsDir);
  const settings = new SettingsRepository(db);
  if (!settings.getAll().hardwareAcceleration) {
    app.disableHardwareAcceleration();
  }

  // Testing-only mechanism (see docs/FINGERPRINT_AUDIT.md for the established
  // PF_E2E_* convention): forces a specific UI language for a fresh test
  // profile so English-text-based E2E selectors keep working regardless of
  // the app's real default locale (Ukrainian). Never set in a normal launch.
  const forcedLocale = process.env['PF_E2E_LOCALE'];
  if (forcedLocale === 'uk' || forcedLocale === 'en') {
    settings.update({ language: forcedLocale });
  }

  let mainWindow: BrowserWindow | null = null;

  app.whenReady().then(() => {
    const profiles = new ProfileRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    const templates = new TemplateRepository(db);
    templates.seedBuiltins();
    const profileManager = new ProfileManager(profilesRoot, profiles, fingerprints, proxies, logs, dbPath);
    const importExport = new ImportExportService(profiles, fingerprints, proxies, logs, profileManager);
    const groups = new GroupRepository(db);
    const downloads = new DownloadRepository(db);

    // Runs for the lifetime of the app (its own interval is .unref()'d, so
    // it never keeps the process alive on its own) — see
    // proxyHealthScheduler.ts for why this exists alongside the manual
    // "Test" button.
    new ProxyHealthScheduler(proxies).start();

    registerIpc({
      profileManager,
      profiles,
      fingerprints,
      proxies,
      logs,
      templates,
      importExport,
      settings,
      groups,
      downloads,
    });

    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      title: 'GoblinAnty',
      icon: path.join(__dirname, '..', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    if (!app.isPackaged && process.env['VITE_DEV_SERVER_URL']) {
      void mainWindow.loadURL(process.env['VITE_DEV_SERVER_URL']);
    } else {
      void mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'));
    }

    setUpAutoUpdater(mainWindow);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void mainWindow?.loadFile(path.join(__dirname, '..', '..', 'dist-renderer', 'index.html'));
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

/**
 * electron-updater reads its feed URL from `build.publish` in package.json
 * (see that file for the real GitHub owner/repo this still needs, and
 * README.md's "Releases and auto-updates" section for how to fill it in or
 * switch providers). Only meaningful for a packaged, signed build — an
 * unpackaged dev run has no real version/feed to check against, so this
 * intentionally no-ops there rather than logging a stream of dev-only
 * "update check failed" noise on every launch.
 *
 * `checkForUpdatesAndNotify()` already shows a native OS notification once
 * an update is downloaded; the `update-downloaded` listener additionally
 * pushes an in-app banner (see App.tsx) so the user isn't relying on the OS
 * notification alone, and `update-error` is logged rather than surfaced —
 * a failed background check should never interrupt someone's browsing.
 */
function setUpAutoUpdater(mainWindow: BrowserWindow): void {
  if (!app.isPackaged) return;

  autoUpdater.logger = log;
  autoUpdater.on('update-available', (info) => {
    log.info('[autoUpdater] update available', info.version);
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info('[autoUpdater] update downloaded, ready to install', info.version);
    mainWindow.webContents.send('pf:update-available', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    log.error('[autoUpdater] update check failed:', err);
  });
  ipcMain.on('pf:update-install', () => {
    autoUpdater.quitAndInstall();
  });

  void autoUpdater.checkForUpdatesAndNotify();
}
