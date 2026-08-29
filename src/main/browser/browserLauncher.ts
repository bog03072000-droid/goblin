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
  ];

  if (params.proxy) {
    const rules =
      params.proxy.protocol === 'socks5'
        ? `socks5://${params.proxy.host}:${params.proxy.port}`
        : `${params.proxy.protocol}=${params.proxy.host}:${params.proxy.port}`;
    args.push(`--proxy-rules=${rules}`);
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (params.proxy?.username) env['PF_PROXY_USERNAME'] = params.proxy.username;
  if (params.proxyPassword) env['PF_PROXY_PASSWORD'] = params.proxyPassword;
  env['TZ'] = params.fingerprint.timezone;

  const child = spawn(electronBinary, args, {
    cwd: path.dirname(entryScript),
    env,
    stdio: 'ignore',
    detached: false,
  });

  return child;
}
