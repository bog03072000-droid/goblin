import { app, BrowserWindow, ipcMain, protocol, screen, session } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import {
  enforceFingerprint,
  applyWebrtcPolicy,
  applyPermissionPolicy,
  injectSpoofingScriptViaCdp,
  type EnforceableFingerprint,
} from './fingerprintEnforcement';
import { buildSpoofingScript } from './spoofingScript';
import { parseArgs, readStdinCredentials } from './profileWindowArgs';
import { setupDownloadHandling } from './profileWindowDownloads';
import { findFreePort, startAutomationProxy } from './automationProxy';
import { humanClick, humanScroll, type CdpSession } from '../../shared/automation/humanInputDriver';
import { runWarmup, type WarmupProgressEvent } from './warmupOrchestrator';
import {
  resolveLanguages,
  buildSpoofableFingerprint,
  resolveEnforcementModes,
  resolveAutoNavigateTarget,
  normalizeNavigationUrl,
} from './profileWindowLogic';

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
          // Lets ProfileManager.waitForAutomationReady() tell "the profile
          // process exists" (RUNNING, set synchronously at spawn) apart from
          // "the automation proxy's listen() callback has actually fired" —
          // this can genuinely be a second or more later, since it only
          // happens after this whenReady() callback runs.
          process.send?.({ type: 'automation-proxy:ready' });
        } catch (err) {
          // Most likely EADDRINUSE (another already-running profile claimed
          // this port, or something else on the machine did) — the profile
          // itself still starts normally, just without automation access,
          // rather than failing the whole launch over an optional feature.
          console.error('[ProfileForge] failed to start automation proxy:', err);
          process.send?.({ type: 'automation-proxy:error', error: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    const partition = `persist:${args.profileId}`;
    const ses = session.fromPartition(partition, { cache: true });

    // Unpacked Chrome extensions configured for this profile — see
    // SECURITY.md's "Chrome extension risks" section for what loading one
    // actually grants (full manifest-declared permissions inside this
    // session, no additional sandboxing, no signature/store verification of
    // the directory's contents). Must run on this persistent session
    // (`persist:` prefix — loadExtension throws on an in-memory session),
    // after app.whenReady() (already true here), and before the webview's
    // first navigation, matching the same "await before first navigation"
    // discipline setProxy() above already follows — an extension's content
    // scripts/background worker need to be registered before any page in
    // this session starts loading, not race against it. One bad/removed
    // path is logged and skipped rather than failing the whole profile
    // launch — same "one bad item doesn't block the rest" posture as every
    // other per-item operation in this app.
    for (const extensionPath of args.extensionPaths) {
      try {
        await ses.loadExtension(extensionPath, { allowFileAccess: false });
      } catch (err) {
        console.error(`[ProfileForge] failed to load extension "${extensionPath}":`, err);
      }
    }

    // Cookie editor support (ProfileManager.sendChildRequest): cookies only
    // ever exist inside this session, which only this process ever holds —
    // the manager process asks over the existing stdio IPC channel (already
    // used for graceful-quit) and correlates the reply by requestId. The
    // manager retries its request for a few seconds if this attaches later
    // than expected (see sendChildRequest's own comment for the real,
    // reproduced race this covers) rather than this needing to signal
    // readiness back somehow.
    process.on('message', (raw) => {
      const msg = raw as { type?: string; requestId?: string; url?: string; name?: string; cookie?: unknown };
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !msg.type.startsWith('cookies:')) return;
      const { requestId } = msg;
      void (async () => {
        try {
          if (msg.type === 'cookies:list') {
            const cookies = await ses.cookies.get({});
            process.send?.({ type: 'cookies:list:result', requestId, cookies });
          } else if (msg.type === 'cookies:remove') {
            await ses.cookies.remove(String(msg.url), String(msg.name));
            process.send?.({ type: 'cookies:remove:result', requestId });
          } else if (msg.type === 'cookies:set') {
            await ses.cookies.set(msg.cookie as Electron.CookiesSetDetails);
            process.send?.({ type: 'cookies:set:result', requestId });
          }
        } catch (err) {
          process.send?.({ type: 'cookies:error', requestId, error: err instanceof Error ? err.message : String(err) });
        }
      })();
    });

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
    const languages = resolveLanguages(args.fingerprintConfig, args.locale);
    ses.setUserAgent(args.userAgent, languages.join(','));

    const { webrtcMode, geolocationMode, permissionsMode } = resolveEnforcementModes(args.fingerprintConfig);
    applyPermissionPolicy(ses, { permissionsMode, geolocationMode });

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

    // Testing-only, gated the same way as PF_E2E_AUTO_DIAGNOSTICS above: logs
    // this profile's own per-process memory breakdown (main/renderer/GPU/
    // utility — app.getAppMetrics() reports every OS process belonging to
    // THIS Electron instance, since one profile == one OS process tree here,
    // same as the module doc comment) to a file next to its userData. Chosen
    // over the originally-suggested CDP `Memory.getBrowserMemoryUsage` —
    // that method doesn't actually exist in the public Chrome DevTools
    // Protocol (the real Memory domain only has getDOMCounters,
    // startSampling/stopSampling, forciblyPurgeJavaScriptMemory, etc., none
    // of which return OS-level process memory) — app.getAppMetrics() is the
    // real, already-battle-tested Electron API for exactly this (it's what
    // Electron's own Task Manager uses internally), and unlike driving the
    // real Windows Task Manager UI it needs no GUI interaction at all, so it
    // sidesteps both the session-isolation and UIPI blockers documented in
    // docs/MEMORY_PROFILE_SINGLE_PROFILE.md.
    if (process.env['PF_DEBUG_MEMORY'] === '1') {
      const memLogPath = path.join(args.userDataDir, 'memory-debug.log');
      const sampleMemory = (): void => {
        const metrics = app.getAppMetrics();
        const line = `${new Date().toISOString()} ${JSON.stringify(metrics.map((m) => ({ type: m.type, pid: m.pid, workingSetKB: m.memory.workingSetSize })))}\n`;
        fs.appendFileSync(memLogPath, line);
      };
      sampleMemory();
      setInterval(sampleMemory, 20000);
    }

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
    const spoofableFingerprint = buildSpoofableFingerprint(args.fingerprintConfig, {
      userAgent: args.userAgent,
      profileId: args.profileId,
    });
    const spoofingScript = buildSpoofingScript(spoofableFingerprint);

    const configB64 = Buffer.from(JSON.stringify(args.fingerprintConfig)).toString('base64');
    const diagnosticsUrl = `profileforge://fingerprint-test?config=${configB64}`;

    // Testing-only mechanisms (see docs/FINGERPRINT_AUDIT.md and TESTING.md):
    // when set by the E2E harness, skip straight to a specific page instead
    // of the real start page, so an automated test doesn't need to drive the
    // UI's address bar inside this separate, otherwise-unreachable-by-
    // Playwright child process window. Never set in a normal launch.
    const autoNavigateTarget = resolveAutoNavigateTarget(process.env, args, diagnosticsUrl, BROWSER_START_URL);

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
      void target.loadURL(normalizeNavigationUrl(String(url)));
    });

    // Lets a user visually confirm humanClick/humanScroll actually work
    // (see the Advanced tab's "Test human input" button) without writing
    // their own automation script — runs against whatever page is
    // currently loaded in this tab, over the SAME `webContents.debugger`
    // CDP session `enforceFingerprint()` already attaches for this tab
    // (see fingerprintEnforcement.ts), adapted to `CdpSession`'s one-method
    // shape. A real, visible mouse movement + click near the center of the
    // page, followed by a scroll — not a no-op smoke test.
    ipcMain.handle('pf:test-human-input', async (_event, webContentsId: number) => {
      const target = webviewsById.get(webContentsId);
      if (!target) throw new Error('No tab is attached yet');
      if (!target.debugger.isAttached()) target.debugger.attach('1.3');
      const session: CdpSession = {
        send: (method, params) => target.debugger.sendCommand(method, params),
      };
      // WebContents (main-process) has no getBounds() — that's a
      // BrowserWindow/<webview>-element method, not available here — so the
      // real loaded page's own viewport size is read via a script
      // evaluation instead, the same thing CDP's own coordinate space uses.
      const viewport = (await target.executeJavaScript('({ w: window.innerWidth, h: window.innerHeight })')) as {
        w: number;
        h: number;
      };
      const from = { x: Math.round(viewport.w * 0.15), y: Math.round(viewport.h * 0.15) };
      const to = { x: Math.round(viewport.w * 0.5), y: Math.round(viewport.h * 0.4) };
      await humanClick(session, from, to, { overshoot: true });
      await humanScroll(session, to, Math.round(viewport.h * 0.6), { pauseProbability: 0.3 });
      return { ok: true };
    });

    // "Warm up profile" toolbar button (see README's Automation section) —
    // Dolphin Anty's "Cookie Robot" concept: visit a list of real URLs in
    // turn, scrolling each like a real person via the same humanScroll
    // primitive/CDP session pattern as pf:test-human-input above, to build
    // organic browsing history/cookies before the profile's actual use.
    // Bounds are deliberately generous but real limits, not decorative —
    // this drives a real webContents.loadURL() against renderer-supplied
    // strings, so both the URL count and the requested duration are capped
    // before anything is attempted.
    ipcMain.handle(
      'pf:warmup',
      async (_event, webContentsId: number, urls: unknown, durationSeconds: unknown) => {
        const target = webviewsById.get(webContentsId);
        if (!target) throw new Error('No tab is attached yet');
        if (!Array.isArray(urls) || urls.length === 0) throw new Error('At least one URL is required');
        if (urls.length > 30) throw new Error('At most 30 URLs per warm-up run');
        if (!urls.every((u) => typeof u === 'string')) throw new Error('Every URL must be a string');
        const duration = Number(durationSeconds);
        if (!Number.isFinite(duration) || duration < 10 || duration > 3600) {
          throw new Error('Duration must be between 10 and 3600 seconds');
        }
        if (!target.debugger.isAttached()) target.debugger.attach('1.3');
        const cdpSession: CdpSession = {
          send: (method, params) => target.debugger.sendCommand(method, params),
        };
        return runWarmup(target, cdpSession, urls as string[], duration, (progress: WarmupProgressEvent) => {
          win.webContents.send('pf:warmup-progress', progress);
        });
      },
    );

    // localStorage editor support (ProfileManager.sendChildRequest, same
    // protocol/retry as the cookies: handlers above). Unlike cookies
    // (session-wide, via ses.cookies), localStorage is per-origin and only
    // reachable by executing JS in a page actually loaded in one of this
    // profile's tabs — there's no session-level API for it. Targets the
    // profile's first/primary tab (webviewsById preserves insertion order);
    // a profile with multiple tabs on different origins only ever exposes
    // that one tab's localStorage here, which is an explicit, documented
    // scope limitation, not an oversight — see StorageTab.tsx's UI copy.
    process.on('message', (raw) => {
      const msg = raw as { type?: string; requestId?: string; key?: string; value?: string };
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string' || !msg.type.startsWith('localStorage:')) return;
      const { requestId } = msg;
      const target = webviewsById.values().next().value as Electron.WebContents | undefined;
      if (!target) {
        process.send?.({ type: 'localStorage:error', requestId, error: 'No tab is attached yet' });
        return;
      }
      void (async () => {
        try {
          if (msg.type === 'localStorage:list') {
            const origin: string = await target.executeJavaScript('window.location.origin');
            const items: Array<{ key: string; value: string }> = await target.executeJavaScript(
              `(function() {
                var out = [];
                for (var i = 0; i < window.localStorage.length; i++) {
                  var k = window.localStorage.key(i);
                  out.push({ key: k, value: window.localStorage.getItem(k) });
                }
                return out;
              })()`,
            );
            process.send?.({ type: 'localStorage:list:result', requestId, origin, items });
          } else if (msg.type === 'localStorage:set') {
            await target.executeJavaScript(
              `window.localStorage.setItem(${JSON.stringify(String(msg.key))}, ${JSON.stringify(String(msg.value))})`,
            );
            process.send?.({ type: 'localStorage:set:result', requestId });
          } else if (msg.type === 'localStorage:remove') {
            await target.executeJavaScript(`window.localStorage.removeItem(${JSON.stringify(String(msg.key))})`);
            process.send?.({ type: 'localStorage:remove:result', requestId });
          }
        } catch (err) {
          process.send?.({ type: 'localStorage:error', requestId, error: err instanceof Error ? err.message : String(err) });
        }
      })();
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

      // injectSpoofingScriptViaCdp() and enforceFingerprint() each
      // independently do `if (!wc.debugger.isAttached()) wc.debugger.attach(...)`
      // on this same WebContents — real, reproduced race (not a test flake):
      // firing them concurrently (as this code used to) lets both see
      // isAttached() === false before either's attach() call has resolved,
      // so the second attach() throws ("already attached"), that rejection
      // is swallowed by its own .catch() below, and whichever call lost the
      // race never actually runs its CDP commands — the spoofing script
      // silently never gets registered for that session (verified via 10
      // isolated reproductions of fingerprintEnforcement.spec.ts's Service
      // Worker test: ~60-70% of runs never removed navigator.serviceWorker
      // at all, not a read-side timing issue — no amount of waiting on the
      // test side fixed it). Chaining injectSpoofingScriptViaCdp() first,
      // then enforceFingerprint() only after it settles, makes the two
      // debugger.attach() calls strictly sequential instead of racing.
      const fp = args.fingerprintConfig;
      injectSpoofingScriptViaCdp(webviewContents, spoofingScript)
        .catch((err: unknown) => {
          console.error('[ProfileForge] CDP spoofing-script injection failed:', err);
        })
        .then(() =>
          enforceFingerprint(webviewContents, {
            os: (fp['os'] as EnforceableFingerprint['os']) ?? 'windows',
            userAgent: args.userAgent,
            platform: String(fp['platform'] ?? 'Win32'),
            languages,
            hardwareConcurrency: Number(fp['hardwareConcurrency'] ?? 8),
            screenWidth: Number(fp['screenWidth'] ?? 1920),
            screenHeight: Number(fp['screenHeight'] ?? 1080),
            deviceScaleFactor: Number(fp['deviceScaleFactor'] ?? 1),
            geolocationMode,
            geolocationLatitude: Number(fp['geolocationLatitude'] ?? 0),
            geolocationLongitude: Number(fp['geolocationLongitude'] ?? 0),
          }),
        )
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

