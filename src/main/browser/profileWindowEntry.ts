import { app, BrowserWindow, ipcMain, protocol, screen, session, shell } from 'electron';
import type { DownloadItem } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { enforceFingerprint, applyWebrtcPolicy, injectSpoofingScript } from './fingerprintEnforcement';
import { buildSpoofingScript, type SpoofableFingerprint } from './spoofingScript';
import type { WebrtcMode, Fingerprint } from '../../shared/schemas/fingerprint';
import type { DownloadEvent } from './browserShellPreload';
import { getDb } from '../database/db';
import { DownloadRepository } from '../database/downloadRepository';

const BROWSER_START_URL = 'https://www.google.com';

// Must run before 'ready' — registers profileforge:// as a standard, fetch-capable
// scheme so the diagnostics page (served from it) behaves like a normal web page
// (relative URLs, fetch, no restricted-scheme quirks) while staying local-only.
protocol.registerSchemesAsPrivileged([
  { scheme: 'profileforge', privileges: { standard: true, secure: true, corsEnabled: true } },
]);

/**
 * Entry point run inside the per-profile child Electron process (spawned by
 * browserLauncher.ts with --profile-window). Each profile gets its own OS
 * process, its own `userData` directory (set below, before `ready`), and its
 * own session partition — this is what gives cookies/localStorage/IndexedDB/
 * cache/history real, durable, cross-restart isolation instead of an in-memory
 * simulation.
 */
export function runProfileWindowProcess(): void {
  const args = parseArgs(process.argv);

  app.setPath('userData', args.userDataDir);
  app.commandLine.appendSwitch('lang', args.locale);
  if (args.proxyRules) {
    app.commandLine.appendSwitch('proxy-server', args.proxyRules);
  }

  // Testing-only mechanism (see docs/FINGERPRINT_AUDIT.md's PF_E2E_* convention):
  // the profile window is a separate OS process Playwright's electron.launch()
  // has no handle on, so an E2E test that needs to drive its actual tab bar
  // opts into a CDP port here and connects via chromium.connectOverCDP().
  // Never set in a normal launch.
  const e2eDebugPort = process.env['PF_E2E_REMOTE_DEBUG_PORT'];
  if (e2eDebugPort) {
    app.commandLine.appendSwitch('remote-debugging-port', e2eDebugPort);
  }

  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    if (authInfo.isProxy && args.proxyUsername && args.proxyPassword) {
      event.preventDefault();
      callback(args.proxyUsername, args.proxyPassword);
    }
  });

  app.whenReady().then(async () => {
    const partition = `persist:${args.profileId}`;
    const ses = session.fromPartition(partition, { cache: true });
    if (args.proxyRules) {
      // Awaited: setProxy() resolves once the proxy config has actually been
      // applied to the session's network context. Without this await, the
      // very first navigation (which happens moments later, right after the
      // webview attaches) could race ahead of the proxy actually being wired
      // up and go out unproxied — a real bug found while adding proxy
      // verification E2E coverage, not a hypothetical one.
      await ses.setProxy({ proxyRules: args.proxyRules });
    }

    // Session-level UA/Accept-Language: covers HTTP headers and any request
    // made before the webview's CDP override (below) attaches. NOTE: the
    // `--lang` switch alone was measured to leak the host OS's real installed
    // languages into navigator.languages (verified during the fingerprint
    // audit — see docs/FINGERPRINT_AUDIT.md) so it is NOT relied on for that;
    // the CDP override in the did-attach-webview handler is the authoritative
    // source for navigator.language/languages/platform.
    const languages = Array.isArray(args.fingerprintConfig['languages'])
      ? (args.fingerprintConfig['languages'] as string[])
      : [args.locale];
    ses.setUserAgent(args.userAgent, languages.join(','));

    const webrtcMode = (args.fingerprintConfig['webrtcMode'] as WebrtcMode | undefined) ?? 'default';

    // Registered on the profile's own session (not the default one) since that's
    // what the <webview partition="..."> actually uses. Serves the local
    // diagnostics page only — profileforge:// resolves no other path, so this
    // cannot become a general local-file-read primitive.
    ses.protocol.handle('profileforge', (request) => {
      const url = new URL(request.url);
      if (url.hostname !== 'fingerprint-test') {
        return new Response('Not found', { status: 404 });
      }
      const html = fs.readFileSync(path.join(__dirname, 'diagnostics.html'));
      return new Response(html, { headers: { 'content-type': 'text/html' } });
    });

    // Fixed 1280x800 previously ignored the actual screen size, leaving the
    // window visibly smaller than the available desktop on most monitors.
    // Sizing to the work area (and maximizing) fills it properly regardless
    // of display resolution.
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const win = new BrowserWindow({
      width,
      height,
      title: `Goblin — ${args.profileName}`,
      icon: path.join(__dirname, '..', '..', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'browserShellPreload.js'),
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
      },
    });
    win.maximize();

    // Downloads are saved under this profile's own storage directory and
    // driven entirely by this profile's own session (`ses`) — since every
    // profile is a fully separate OS process with its own userDataDir and
    // session partition (see the module doc comment above), there is no
    // code path by which one profile's download could land in, or even see,
    // another profile's directory.
    const downloadsDir = path.join(args.userDataDir, 'downloads');
    const downloads = new Map<string, DownloadItem>();
    let nextDownloadId = 1;

    function uniqueSavePath(dir: string, filename: string): string {
      fs.mkdirSync(dir, { recursive: true });
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      let candidate = path.join(dir, filename);
      let n = 1;
      while (fs.existsSync(candidate)) {
        candidate = path.join(dir, `${base} (${n})${ext}`);
        n++;
      }
      return candidate;
    }

    // Recording is best-effort and lazily-connected: the manager app's own DB
    // migrations already ran by the time any profile is ever started (the
    // manager opens it at app startup, before its window/IPC even exist), so
    // this call only ever *reuses* an already-migrated file — it never races
    // schema creation. See docs — same WAL-mode file, second OS process.
    function recordDownload(
      profileId: string,
      filename: string,
      savePath: string,
      url: string,
      totalBytes: number,
      state: 'completed' | 'cancelled' | 'failed',
    ): void {
      if (!args.dbPath) return;
      try {
        const db = getDb(args.dbPath, migrationsDir());
        new DownloadRepository(db).create({ profileId, filename, savePath, url, totalBytes, state });
      } catch (err) {
        console.error('[ProfileForge] failed to record download history:', err);
      }
    }

    ses.on('will-download', (_event, item) => {
      const id = String(nextDownloadId++);
      const savePath = uniqueSavePath(downloadsDir, item.getFilename());
      item.setSavePath(savePath);
      downloads.set(id, item);

      const send = (state: DownloadEvent['state']): void => {
        win.webContents.send('pf:download-event', {
          id,
          filename: path.basename(savePath),
          savePath,
          state,
          receivedBytes: item.getReceivedBytes(),
          totalBytes: item.getTotalBytes(),
        } satisfies DownloadEvent);
      };
      send('started');

      item.on('updated', (_e, state) => {
        send(state === 'interrupted' ? 'failed' : 'progressing');
      });
      item.once('done', (_e, state) => {
        const finalState = state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'failed';
        send(finalState);
        recordDownload(args.profileId, path.basename(savePath), savePath, item.getURL(), item.getTotalBytes(), finalState);
      });
    });

    ipcMain.on('pf:download-open', (_e, id: string) => {
      const item = downloads.get(id);
      if (item) void shell.openPath(item.getSavePath());
    });
    ipcMain.on('pf:download-show', (_e, id: string) => {
      const item = downloads.get(id);
      if (item) shell.showItemInFolder(item.getSavePath());
    });
    ipcMain.on('pf:download-cancel', (_e, id: string) => {
      const item = downloads.get(id);
      if (item && item.getState() === 'progressing') item.cancel();
    });

    // Forced here (main process) rather than left to the <webview> tag's own
    // `preload` attribute, so a compromised/malicious page loaded inside the
    // webview cannot get the guest to request a different preload for itself.
    win.webContents.on('will-attach-webview', (_event, webPreferences) => {
      webPreferences.preload = path.join(__dirname, 'diagnosticsPreload.js');
    });

    const configB64 = Buffer.from(JSON.stringify(args.fingerprintConfig)).toString('base64');
    const diagnosticsUrl = `profileforge://fingerprint-test?config=${configB64}`;

    // Testing-only mechanisms (see docs/FINGERPRINT_AUDIT.md and TESTING.md):
    // when set by the E2E harness, skip straight to a specific page instead
    // of the real start page, so an automated test doesn't need to drive the
    // UI's address bar inside this separate, otherwise-unreachable-by-
    // Playwright child process window. Never set in a normal launch.
    const autoNavigateTarget =
      process.env['PF_E2E_AUTO_DIAGNOSTICS'] === '1'
        ? diagnosticsUrl
        : (process.env['PF_E2E_PROXY_TEST_URL'] ?? args.navigateTo ?? BROWSER_START_URL);

    // The webview starts at about:blank (see browser-shell.html); once Electron
    // attaches its guest WebContents here, the CDP fingerprint overrides are
    // applied and ONLY THEN does the real navigation start — so the very first
    // page load already reflects platform/languages/hardwareConcurrency/screen
    // instead of racing a reload against them.
    win.webContents.on('did-attach-webview', (_event, webviewContents) => {
      applyWebrtcPolicy(webviewContents, webrtcMode);

      const fp = args.fingerprintConfig;
      const spoofableFingerprint: SpoofableFingerprint = {
        seed: String(fp['seed'] ?? args.profileId),
        canvasMode: (fp['canvasMode'] as Fingerprint['canvasMode']) ?? 'off',
        audioMode: (fp['audioMode'] as Fingerprint['audioMode']) ?? 'off',
        deviceMemory: Number(fp['deviceMemory'] ?? 8),
        webglSpoofingMode: (fp['webglSpoofingMode'] as Fingerprint['webglSpoofingMode']) ?? 'off',
        webglVendor: String(fp['webglVendor'] ?? 'Google Inc.'),
        webglRenderer: String(fp['webglRenderer'] ?? 'ANGLE'),
        fontsMode: (fp['fontsMode'] as Fingerprint['fontsMode']) ?? 'system',
        mediaDevicesMode: (fp['mediaDevicesMode'] as Fingerprint['mediaDevicesMode']) ?? 'real',
      };

      enforceFingerprint(webviewContents, {
        userAgent: args.userAgent,
        platform: String(fp['platform'] ?? 'Win32'),
        languages,
        hardwareConcurrency: Number(fp['hardwareConcurrency'] ?? 8),
        screenWidth: Number(fp['screenWidth'] ?? 1920),
        screenHeight: Number(fp['screenHeight'] ?? 1080),
        deviceScaleFactor: Number(fp['deviceScaleFactor'] ?? 1),
      })
        .then(() => injectSpoofingScript(webviewContents, buildSpoofingScript(spoofableFingerprint)))
        .catch((err: unknown) => {
          console.error('[ProfileForge] fingerprint enforcement failed:', err);
        })
        .finally(() => {
          void webviewContents.loadURL(autoNavigateTarget);
        });
    });

    // Fulfills the "fingerprint snapshot on start" requirement: whenever the
    // diagnostics page runs (opened manually via the toolbar, or automatically
    // in test mode above) it hands its configured-vs-observed report to the
    // preload bridge, which forwards it here to be written into the profile's
    // own directory — technical diagnostic values only, never page content,
    // cookies, or browsing history.
    ipcMain.on('pf:diagnostics-report', (_event, report: unknown) => {
      try {
        const snapshotPath = path.join(path.dirname(args.userDataDir), 'fingerprint-snapshot.json');
        fs.writeFileSync(snapshotPath, JSON.stringify(report, null, 2), 'utf-8');
      } catch (err) {
        console.error('[ProfileForge] failed to write fingerprint snapshot:', err);
      }
    });

    const shellPath = path.join(__dirname, 'browser-shell.html');
    const query = new URLSearchParams({
      partition,
      ua: args.userAgent,
      start: BROWSER_START_URL,
      label: args.profileName,
      diagnostics: diagnosticsUrl,
    });
    void win.loadFile(shellPath, { search: query.toString() });

    win.on('closed', () => {
      app.quit();
    });
  });
}

interface ProfileWindowArgs {
  profileId: string;
  profileName: string;
  userDataDir: string;
  userAgent: string;
  locale: string;
  proxyRules: string | null;
  proxyUsername: string | null;
  proxyPassword: string | null;
  fingerprintConfig: Record<string, unknown>;
  dbPath: string | null;
  navigateTo: string | null;
}

/** Same logic main.ts uses for the manager process — recomputed here rather
 * than passed as a CLI arg because it depends only on `app.isPackaged`/
 * `process.resourcesPath`, which are identical for this child process (same
 * Electron binary and app bundle, just a different --profile-window flag).
 * NOTE: one `..` deeper than main.ts's version — this file compiles to
 * dist-electron/main/browser/profileWindowEntry.js, one directory below
 * main.ts's dist-electron/main/main.js, so it needs an extra step up to
 * reach the repo root in dev mode. */
function migrationsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'database', 'migrations')
    : path.join(__dirname, '..', '..', '..', 'database', 'migrations');
}

function parseArgs(argv: string[]): ProfileWindowArgs {
  const get = (name: string): string | null => {
    const prefix = `--${name}=`;
    const found = argv.find((a) => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : null;
  };
  const profileId = get('profile-id');
  const profileName = get('profile-name');
  const userDataDir = get('user-data-dir');
  const userAgent = get('user-agent');
  if (!profileId || !profileName || !userDataDir || !userAgent) {
    throw new Error('Missing required profile window arguments');
  }
  const fingerprintConfigB64 = get('fingerprint-config');
  let fingerprintConfig: Record<string, unknown> = {};
  if (fingerprintConfigB64) {
    try {
      fingerprintConfig = JSON.parse(Buffer.from(fingerprintConfigB64, 'base64').toString('utf-8')) as Record<
        string,
        unknown
      >;
    } catch {
      fingerprintConfig = {};
    }
  }
  return {
    profileId,
    profileName,
    userDataDir,
    userAgent,
    locale: get('locale') ?? 'en-US',
    proxyRules: get('proxy-rules'),
    proxyUsername: process.env['PF_PROXY_USERNAME'] ?? null,
    proxyPassword: process.env['PF_PROXY_PASSWORD'] ?? null,
    fingerprintConfig,
    dbPath: get('db-path'),
    navigateTo: get('navigate-to'),
  };
}
