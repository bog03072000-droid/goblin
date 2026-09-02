import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface ProfileWindowArgs {
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
  /** Not secret (unlike the token) — the port a client connects to, safe as
   * a plain CLI arg. Null when automation is disabled for this profile. */
  automationPort: number | null;
}

/** Same logic main.ts uses for the manager process — recomputed here rather
 * than passed as a CLI arg because it depends only on `app.isPackaged`/
 * `process.resourcesPath`, which are identical for this child process (same
 * Electron binary and app bundle, just a different --profile-window flag).
 * NOTE: one `..` deeper than main.ts's version — this file compiles to
 * dist-electron/main/browser/profileWindowArgs.js, one directory below
 * main.ts's dist-electron/main/main.js, so it needs an extra step up to
 * reach the repo root in dev mode. */
export function migrationsDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'database', 'migrations')
    : path.join(__dirname, '..', '..', '..', 'database', 'migrations');
}

export function parseArgs(argv: string[]): ProfileWindowArgs {
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
    // Filled in by readStdinCredentials() right after this returns — never
    // sourced from argv/env, since both are visible to other processes on
    // this machine for the child's whole lifetime (argv via any process
    // listing tool, env vars via /proc or Task Manager), unlike a one-shot
    // stdin read.
    proxyUsername: null,
    proxyPassword: null,
    fingerprintConfig,
    dbPath: get('db-path'),
    navigateTo: get('navigate-to'),
    automationPort: (() => {
      const raw = get('automation-port');
      const parsed = raw ? Number(raw) : NaN;
      return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    })(),
  };
}

/** Reads the one newline-terminated JSON line browserLauncher.ts's spawn()
 * call writes to this process's stdin, immediately followed by stdin.end().
 * This is the replacement for passing proxy credentials as environment
 * variables: an env var stays readable by any other process running as the
 * same OS user for the whole lifetime of this child process (via /proc on
 * Linux or Task Manager on Windows), while a stdin write is consumed once
 * and never retained anywhere after.
 *
 * Deliberately synchronous (`fs.readFileSync(0, ...)`) rather than the
 * async `process.stdin` stream API: the async 'data'/'end' event approach
 * was tried first and, verified empirically against a real packaged
 * profile-window child process, never fired a single 'data' event even
 * though the parent's write() completed successfully (confirmed via its
 * own completion callback) — 'end' fired immediately with an empty buffer,
 * as if the child's `process.stdin` were a distinct stream from the pipe
 * the parent actually wrote to. This is a known category of Electron/
 * Windows main-process stdin quirk; reading fd 0 directly and synchronously
 * sidesteps whatever stream-wiring issue causes it, and is the standard,
 * well-tested pattern for reading all of a piped (non-TTY) stdin in Node.
 * Only attempted when stdin isn't a TTY — an interactive `electron .
 * --profile-window ...` run from a real terminal (dev debugging only; every
 * real launch goes through browserLauncher.ts's piped spawn) would
 * otherwise block here waiting for a human to type EOF. */
export function readStdinCredentials(): {
  proxyUsername: string | null;
  proxyPassword: string | null;
  automationToken: string | null;
} {
  if (process.stdin.isTTY) return { proxyUsername: null, proxyPassword: null, automationToken: null };
  try {
    const raw = fs.readFileSync(0, 'utf-8').split('\n')[0] ?? '';
    const parsed = JSON.parse(raw) as {
      proxyUsername?: string | null;
      proxyPassword?: string | null;
      automationToken?: string | null;
    };
    return {
      proxyUsername: parsed.proxyUsername ?? null,
      proxyPassword: parsed.proxyPassword ?? null,
      automationToken: parsed.automationToken ?? null,
    };
  } catch {
    return { proxyUsername: null, proxyPassword: null, automationToken: null };
  }
}
