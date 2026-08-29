import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';

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

  app.whenReady().then(() => {
    const partition = `persist:${args.profileId}`;
    const ses = session.fromPartition(partition, { cache: true });
    if (args.proxyRules) {
      void ses.setProxy({ proxyRules: args.proxyRules });
    }
    ses.setUserAgent(args.userAgent);

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      title: `ProfileForge — ${args.profileName}`,
      webPreferences: {
        webviewTag: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition,
      },
    });

    const shellPath = path.join(__dirname, 'browser-shell.html');
    const query = new URLSearchParams({
      partition,
      ua: args.userAgent,
      start: 'https://www.google.com',
      label: args.profileName,
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
  return {
    profileId,
    profileName,
    userDataDir,
    userAgent,
    locale: get('locale') ?? 'en-US',
    proxyRules: get('proxy-rules'),
    proxyUsername: process.env['PF_PROXY_USERNAME'] ?? null,
    proxyPassword: process.env['PF_PROXY_PASSWORD'] ?? null,
  };
}
