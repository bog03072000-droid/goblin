import { app, BrowserWindow, ipcMain, protocol, screen, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { enforceFingerprint, applyWebrtcPolicy } from './fingerprintEnforcement';
import { buildSpoofingScript, type SpoofableFingerprint } from './spoofingScript';
import type { WebrtcMode, Fingerprint } from '../../shared/schemas/fingerprint';
import { parseArgs, readStdinCredentials } from './profileWindowArgs';
import { setupDownloadHandling } from './profileWindowDownloads';
import { findFreePort, startAutomationProxy } from './automationProxy';

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
  const credentials = readStdinCredentials();
  args.proxyUsername = credentials.proxyUsername;
  args.proxyPassword = credentials.proxyPassword;
  const automationToken = credentials.automationToken;

  // Requested by ProfileManager.stop() (see its comment for why): app.quit()
  // runs Electron/Chromium's normal shutdown sequence, which flushes the
  // cookie/localStorage backing stores to disk before the process actually
  // exits — a hard kill() from the parent can't guarantee that. Verified by
  // instrumenting this handler directly (message receipt + before-quit/
  // will-quit firing, confirmed via a throwaway diagnostic script) — the
  // mechanism itself works correctly; the E2E flakiness this was suspected
  // of causing was actually a read-side race in the test, now fixed by
  // polling instead of reading once (see profileBrowserLifecycle.spec.ts).
  process.on('message', (msg) => {
    if (msg === 'graceful-quit') app.quit();
  });

  app.setPath('userData', args.userDataDir);
  app.commandLine.appendSwitch('lang', args.locale);
  if (args.proxyRules) {
    app.commandLine.appendSwitch('proxy-server', args.proxyRules);
  }

  // Testing-only mechanism (see docs/FINGERPRINT_AUDIT.md's PF_E2E_* convention):
  // the profile window is a separate OS process Playwright's electron.launch()
  // has no handle on, so an E2E test that needs to drive its actual tab bar
  // opts into a CDP port here and connects via chromium.connectOverCDP().
  // Never set in a normal launch. Mutually exclusive with the real automation
  // port below — tests never set both.
  const e2eDebugPort = process.env['PF_E2E_REMOTE_DEBUG_PORT'];

  // `--remote-debugging-port` must be set before Electron's internal 'ready'
  // fires, but finding a free port is genuinely async (a real listen()/
  // close() round trip) — so this is kicked off as the very first thing in
  // the process, before any other async work, to minimize the window before
  // Chromium's own (much slower) bootstrap reaches the point of locking in
  // switches. The real internal CDP port this reserves is never told to
  // anything but startAutomationProxy() below — see automationProxy.ts's own
  // module comment for why raw CDP can't be given a token directly and needs
  // an authenticating proxy in front of it instead.
  const automationInternalPort: Promise<number | null> = (async () => {
    if (e2eDebugPort) {
      app.commandLine.appendSwitch('remote-debugging-port', e2eDebugPort);
      return null;
    }
    if (args.automationPort && automationToken) {
      const internalPort = await findFreePort();
      app.commandLine.appendSwitch('remote-debugging-port', String(internalPort));
      return internalPort;
    }
    return null;
  })();

  app.on('login', (event, _webContents, _details, authInfo, callback) => {
    if (authInfo.isProxy && args.proxyUsername && args.proxyPassword) {
      event.preventDefault();
      callback(args.proxyUsername, args.proxyPassword);
    }
  });

  app.whenReady().then(async () => {
    if (args.automationPort && automationToken) {
      const internalPort = await automationInternalPort;
      if (internalPort) {
        try {
          await startAutomationProxy({ port: args.automationPort, internalPort, token: automationToken });
        } catch (err) {
          // Most likely EADDRINUSE (another already-running profile claimed
          // this port, or something else on the machine did) — the profile
          // itself still starts normally, just without automation access,
          // rather than failing the whole launch over an optional feature.
          console.error('[ProfileForge] failed to start automation proxy:', err);
        }
      }
    }

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
      title: `GoblinAnty — ${args.profileName}`,
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

    setupDownloadHandling({ win, ses, userDataDir: args.userDataDir, profileId: args.profileId, dbPath: args.dbPath });

    // Forced here (main process) rather than left to the <webview> tag's own
    // `preload` attribute, so a compromised/malicious page loaded inside the
    // webview cannot get the guest to request a different preload for itself.
    win.webContents.on('will-attach-webview', (_event, webPreferences) => {
      webPreferences.preload = path.join(__dirname, 'diagnosticsPreload.js');
    });

    // Computed once, outside any per-attach handler, so both the sync IPC
    // handler below (answered from diagnosticsPreload.js, which needs the
    // script BEFORE the guest page's own scripts run) and did-attach-webview
    // (still applying the CDP-only fields) see the identical fingerprint.
    const fpForSpoofing = args.fingerprintConfig;
    const spoofableFingerprint: SpoofableFingerprint = {
      seed: String(fpForSpoofing['seed'] ?? args.profileId),
      canvasMode: (fpForSpoofing['canvasMode'] as Fingerprint['canvasMode']) ?? 'off',
      audioMode: (fpForSpoofing['audioMode'] as Fingerprint['audioMode']) ?? 'off',
      deviceMemory: Number(fpForSpoofing['deviceMemory'] ?? 8),
      webglSpoofingMode: (fpForSpoofing['webglSpoofingMode'] as Fingerprint['webglSpoofingMode']) ?? 'off',
      webglVendor: String(fpForSpoofing['webglVendor'] ?? 'Google Inc.'),
      webglRenderer: String(fpForSpoofing['webglRenderer'] ?? 'ANGLE'),
      fontsMode: (fpForSpoofing['fontsMode'] as Fingerprint['fontsMode']) ?? 'system',
      mediaDevicesMode: (fpForSpoofing['mediaDevicesMode'] as Fingerprint['mediaDevicesMode']) ?? 'real',
      userAgent: args.userAgent,
      platform: String(fpForSpoofing['platform'] ?? 'Win32'),
      hardwareConcurrency: Number(fpForSpoofing['hardwareConcurrency'] ?? 8),
    };
    const spoofingScript = buildSpoofingScript(spoofableFingerprint);

    // Answered synchronously (event.returnValue, not an async invoke) because
    // diagnosticsPreload.js must have this script in hand and injected before
    // the guest page's own scripts get a chance to run — an async round trip
    // would race that. One profile == one OS process here (see the module
    // doc comment), so a single global handler for this channel is safe.
    ipcMain.on('pf:get-spoofing-script', (event) => {
      event.returnValue = spoofingScript;
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

    // Keyed by webContents.id (the renderer reads its own tab's id via the
    // <webview> element's getWebContentsId() and passes it back on
    // 'pf:navigate' — see browserShellPreload.ts's pfNav bridge and its
    // comment for why explicit navigation is routed through here rather than
    // the <webview> tag's `src` attribute). Entries are removed on
    // 'destroyed' so closing tabs doesn't leak references.
    const webviewsById = new Map<number, Electron.WebContents>();
    ipcMain.on('pf:navigate', (_event, webContentsId: number, url: string) => {
      const target = webviewsById.get(webContentsId);
      if (!target) return;
      let normalized = String(url).trim();
      if (!/^[a-zA-Z]+:\/\//.test(normalized)) normalized = 'https://' + normalized;
      void target.loadURL(normalized);
    });

    // The webview starts at about:blank (see browser-shell.html); once Electron
    // attaches its guest WebContents here, the CDP fingerprint overrides are
    // applied and ONLY THEN does the real navigation start — so the very first
    // page load already reflects platform/languages/hardwareConcurrency/screen
    // instead of racing a reload against them.
    win.webContents.on('did-attach-webview', (_event, webviewContents) => {
      applyWebrtcPolicy(webviewContents, webrtcMode);

      webviewsById.set(webviewContents.id, webviewContents);
      webviewContents.once('destroyed', () => webviewsById.delete(webviewContents.id));

      // Real, reproducible race found via a live CI E2E failure (not a test
      // flake): enforceFingerprint's CDP round trip below is async, and if a
      // real navigation (the address bar, "New Tab" duplicate flow, etc.)
      // starts before it resolves, this handler's own deferred loadURL below
      // used to fire afterward and silently overwrite that navigation back
      // to the default start page. Invisible on a fast dev machine — the CDP
      // round trip resolves before anyone could type a URL — but a slower CI
      // runner widens that window enough to lose the race consistently.
      // Tracking any non-blank did-start-navigation lets the deferred call
      // step aside instead of clobbering whatever already started.
      let explicitNavigationSeen = false;
      webviewContents.on('did-start-navigation', (navEvent) => {
        if (navEvent.url && navEvent.url !== 'about:blank') explicitNavigationSeen = true;
      });

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
          if (!explicitNavigationSeen) {
            void webviewContents.loadURL(autoNavigateTarget);
          }
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

