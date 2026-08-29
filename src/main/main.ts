import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { getDb } from './database/db';
import { ProfileRepository } from './database/profileRepository';
import { FingerprintRepository } from './database/fingerprintRepository';
import { ProxyRepository } from './database/proxyRepository';
import { ActivityLogRepository } from './database/activityLogRepository';
import { TemplateRepository } from './database/templateRepository';
import { SettingsRepository } from './database/settingsRepository';
import { ProfileManager } from './profiles/profileManager';
import { ImportExportService } from './profiles/importExport';
import { registerIpc } from './ipc/registerIpc';
import { runProfileWindowProcess } from './browser/profileWindowEntry';

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

  let mainWindow: BrowserWindow | null = null;

  app.whenReady().then(() => {
    const profiles = new ProfileRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    const templates = new TemplateRepository(db);
    templates.seedBuiltins();
    const profileManager = new ProfileManager(profilesRoot, profiles, fingerprints, proxies, logs);
    const importExport = new ImportExportService(profiles, fingerprints, proxies, logs, profileManager);

    registerIpc({ profileManager, profiles, fingerprints, proxies, logs, templates, importExport, settings });

    mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      title: 'ProfileForge',
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
