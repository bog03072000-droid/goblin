import { app } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import type { Fingerprint } from '../../shared/schemas/fingerprint';
import type { ProxyRecord } from '../../shared/schemas/proxy';

export interface LaunchParams {
  profileId: string;
  profileName: string;
  userDataDir: string;
  fingerprint: Fingerprint;
  proxy: ProxyRecord | null;
  proxyPassword: string | null;
  /** Path to the shared manager SQLite database, so this profile's own child
   * process can record completed downloads into the same `downloads` table
   * the manager UI reads — see profileWindowEntry.ts's `recordDownload()`. */
  dbPath: string;
  /** Used by the Downloads page's "Re-download" action to navigate straight
   * at a specific URL instead of the normal start page. */
  initialUrl?: string;
}

/**
 * Launches one profile as an independent Electron/Chromium OS process (rather
 * than a BrowserWindow inside the manager process), the same architecture real
 * multi-profile browsers use. This is what makes profile storage genuinely
 * survive app restarts/crashes of the *manager* window and keeps one profile's
 * renderer crash from taking others down.
 */
export function launchProfileProcess(params: LaunchParams): ChildProcess {
  const electronBinary = process.execPath;
  const entryScript = app.getAppPath();

  const fingerprintConfigB64 = Buffer.from(
    JSON.stringify({
      userAgent: params.fingerprint.userAgent,
      platform: params.fingerprint.platform,
      locale: params.fingerprint.locale,
      languages: params.fingerprint.languages,
      timezone: params.fingerprint.timezone,
      screenWidth: params.fingerprint.screenWidth,
      screenHeight: params.fingerprint.screenHeight,
      deviceScaleFactor: params.fingerprint.deviceScaleFactor,
      hardwareConcurrency: params.fingerprint.hardwareConcurrency,
      deviceMemory: params.fingerprint.deviceMemory,
      webglVendor: params.fingerprint.webglVendor,
      webglRenderer: params.fingerprint.webglRenderer,
      webrtcMode: params.fingerprint.webrtcMode,
      canvasMode: params.fingerprint.canvasMode,
      audioMode: params.fingerprint.audioMode,
      fontsMode: params.fingerprint.fontsMode,
      mediaDevicesMode: params.fingerprint.mediaDevicesMode,
      webglSpoofingMode: params.fingerprint.webglSpoofingMode,
      seed: params.fingerprint.seed,
    }),
  ).toString('base64');

  const args = [
    entryScript,
    '--profile-window',
    `--profile-id=${params.profileId}`,
    `--profile-name=${params.profileName}`,
    `--user-data-dir=${params.userDataDir}`,
    `--user-agent=${params.fingerprint.userAgent}`,
    `--locale=${params.fingerprint.locale}`,
    `--fingerprint-config=${fingerprintConfigB64}`,
    `--db-path=${params.dbPath}`,
  ];

  if (params.initialUrl) {
    args.push(`--navigate-to=${params.initialUrl}`);
  }

  if (params.proxy) {
    // Chromium's --proxy-server/session.setProxy syntax treats a
    // "<scheme>=host:port" rule as applying ONLY to requests of that
    // destination scheme — an "http=" rule silently leaves all https://
    // traffic unproxied (falls through to a direct connection instead).
    // A bare "host:port" with no scheme prefix is the one that covers every
    // destination scheme uniformly, which is what a configured "http" or
    // "https" proxy record is actually expected to do (handle both http and
    // https browsing, same as every mainstream browser's proxy setting).
    // Only socks5 needs its own scheme prefix, since it's a distinct proxy
    // protocol rather than a destination-scheme filter.
    const rules =
      params.proxy.protocol === 'socks5'
        ? `socks5://${params.proxy.host}:${params.proxy.port}`
        : `${params.proxy.host}:${params.proxy.port}`;
    args.push(`--proxy-rules=${rules}`);
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (params.proxy?.username) env['PF_PROXY_USERNAME'] = params.proxy.username;
  if (params.proxyPassword) env['PF_PROXY_PASSWORD'] = params.proxyPassword;
  env['TZ'] = params.fingerprint.timezone;

  const child = spawn(electronBinary, args, {
    cwd: path.dirname(entryScript),
    env,
    // The 'ipc' channel (fd 3) is what lets ProfileManager.stop() ask this
    // process to shut down gracefully (app.quit(), which flushes Chromium's
    // cookie/localStorage stores) instead of only ever having a hard kill()
    // available — see profileManager.ts's stop() for why that distinction
    // turned out to matter for real. stdout/stderr stay ignored, same as before.
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    detached: false,
  });

  return child;
}
