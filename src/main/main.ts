import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { getDb } from './database/db';
import { ProfileRepository } from './database/profileRepository';
import { FingerprintRepository } from './database/fingerprintRepository';
import { ProxyRepository } from './database/proxyRepository';
import { ActivityLogRepository } from './database/activityLogRepository';
import { ProfileManager } from './profiles/profileManager';
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

  let mainWindow: BrowserWindow | null = null;

  app.whenReady().then(() => {
    const db = getDb(dbPath, migrationsDir);
    const profiles = new ProfileRepository(db);
    const fingerprints = new FingerprintRepository(db);
    const proxies = new ProxyRepository(db);
    const logs = new ActivityLogRepository(db);
    const profileManager = new ProfileManager(profilesRoot, profiles, fingerprints, proxies, logs);

    registerIpc({ profileManager, profiles, fingerprints, proxies, logs });

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
