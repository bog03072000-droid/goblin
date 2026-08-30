import { app, BrowserWindow, ipcMain, protocol, screen, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { enforceFingerprint, applyWebrtcPolicy } from './fingerprintEnforcement';
import type { WebrtcMode } from '../../shared/schemas/fingerprint';

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
      title: `ProfileForge — ${args.profileName}`,
      icon: path.join(__dirname, '..', '..', 'icon.png'),
      webPreferences: {
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
      },
    });
    win.maximize();

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
        : (process.env['PF_E2E_PROXY_TEST_URL'] ?? BROWSER_START_URL);

    // The webview starts at about:blank (see browser-shell.html); once Electron
    // attaches its guest WebContents here, the CDP fingerprint overrides are
    // applied and ONLY THEN does the real navigation start — so the very first
    // page load already reflects platform/languages/hardwareConcurrency/screen
    // instead of racing a reload against them.
    win.webContents.on('did-attach-webview', (_event, webviewContents) => {
      applyWebrtcPolicy(webviewContents, webrtcMode);

      const fp = args.fingerprintConfig;
      enforceFingerprint(webviewContents, {
        userAgent: args.userAgent,
        platform: String(fp['platform'] ?? 'Win32'),
        languages,
        hardwareConcurrency: Number(fp['hardwareConcurrency'] ?? 8),
        screenWidth: Number(fp['screenWidth'] ?? 1920),
        screenHeight: Number(fp['screenHeight'] ?? 1080),
        deviceScaleFactor: Number(fp['deviceScaleFactor'] ?? 1),
      })
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
  };
}
