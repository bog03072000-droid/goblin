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
  /** Not secret — safe as a plain CLI arg (see automationToken below, which
   * is not). Null/undefined when automation is disabled for this profile. */
  automationPort?: number | null;
  /** A secret, like proxyPassword — passed via stdin below, never as a CLI
   * arg or env var (both stay readable by any other process on this machine
   * for the child's whole lifetime; see the stdin-write comment below). */
  automationToken?: string | null;
  /** Absolute paths to unpacked Chrome extension directories to load into
   * this profile's session on launch — see SECURITY.md's "Chrome extension
   * risks" section. Not secret (just local filesystem paths), safe as a
   * plain CLI arg like automationPort. */
  extensionPaths?: string[];
}

const TRANSIENT_SPAWN_ERROR_CODES = new Set(['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM']);

/** True for spawn failures worth retrying after a short delay — transient
 * OS-level resource pressure (too many open file handles, temporarily out of
 * process slots/memory) rather than a genuine, permanent problem (missing
 * binary, permission denied) that an identical retry would just reproduce.
 * Used by ProfileManager.start() to decide whether the async child "error"
 * event should trigger a retry or go straight to marking the profile ERROR. */
export function isTransientSpawnError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' && TRANSIENT_SPAWN_ERROR_CODES.has(code);
}

/** `Fingerprint` fields the child process genuinely never needs — DB
 * bookkeeping (`id`/`name`/`createdAt`/`updatedAt`, already carried
 * separately as `profileId`/`profileName`) or fields fully subsumed by
 * another one already sent (`osVersion`/`browserVersion` are baked into the
 * already-sent `userAgent` string; nothing downstream reads them
 * independently — confirmed by grepping for both names across
 * `src/main/browser/`). Every other `Fingerprint` field is forwarded
 * automatically by `pickChildProcessFingerprintFields` below — this is
 * deliberately an *exclude* list, not the old *include* allowlist, so a
 * field added to `FingerprintSchema` in the future reaches the child process
 * by default instead of silently being dropped. That silent-drop is exactly
 * what happened twice with `os` and `maxTouchPoints` (see
 * docs/FINGERPRINT_AUDIT.md's "Tenth investigation") before this file was
 * changed to build the allowlist by hand for each new field — this removes
 * that whole bug class structurally rather than promising to remember next
 * time. */
const CHILD_PROCESS_EXCLUDED_FINGERPRINT_FIELDS = new Set<keyof Fingerprint>([
  'id',
  'name',
  'osVersion',
  'browserVersion',
  'createdAt',
  'updatedAt',
]);

/** Exported for direct unit testing — see browserLauncher.test.ts's coverage
 * asserting every non-excluded `Fingerprint` field survives, and that a
 * brand new field (simulated via an object literal wider than the real
 * type) is forwarded without this file needing to change. */
export function pickChildProcessFingerprintFields(fingerprint: Fingerprint): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fingerprint).filter(
      ([key]) => !CHILD_PROCESS_EXCLUDED_FINGERPRINT_FIELDS.has(key as keyof Fingerprint),
    ),
  );
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
    JSON.stringify(pickChildProcessFingerprintFields(params.fingerprint)),
  ).toString('base64');

  // Tried and reverted (real measurement, not assumption): a set of
  // Puppeteer/Playwright-style flags (--disable-background-networking,
  // --disable-component-update, --disable-sync, --disable-features=
  // Translate,OptimizationHints,MediaRouter, etc.) that skip Google-service
  // integrations this app never uses, on the theory that they'd lower
  // per-profile RAM at bulk-start scale. Measured against the real
  // 20/50-profile baselines in LOAD_TEST_BULKSTART_RAW.md: results were
  // mixed-to-worse, not better (50 profiles at maxConcurrentLaunches=4 used
  // ~19% MORE peak RAM with the flags than without). Reverted rather than
  // kept on a plausible-sounding but unproven theory — see this project's
  // whole convention of measuring before claiming.
  //
  // --in-process-gpu, unlike the above, IS kept — a different hypothesis
  // (fewer OS processes per profile, not fewer Chromium subsystems) that
  // real measurement confirmed: 5 processes / ~617MB per running profile
  // (matching LOAD_TEST.md's own ~585MB baseline) dropped to 4 processes /
  // ~527MB — a real ~15% per-profile RAM reduction, measured 3x for
  // consistency, not a one-off. Runs Chromium's GPU command processing
  // inside the browser process instead of a separate one; verified this
  // doesn't silently break or change fingerprint behavior: the full
  // fingerprintEnforcement.spec.ts suite (including the WebGL vendor/
  // renderer spoofing test, which also confirms WebGL itself keeps
  // rendering) passes unchanged, and a live CreepJS capture came back with
  // the exact same clean stealth-score hash (0c019315) as the untouched
  // baseline — same verification standard as every other fingerprint-
  // adjacent change in this project.
  const args = [
    entryScript,
    '--in-process-gpu',
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

  if (params.automationPort) {
    args.push(`--automation-port=${params.automationPort}`);
  }

  if (params.extensionPaths && params.extensionPaths.length > 0) {
    args.push(`--extension-paths=${Buffer.from(JSON.stringify(params.extensionPaths)).toString('base64')}`);
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
  env['TZ'] = params.fingerprint.timezone;

  const child = spawn(electronBinary, args, {
    cwd: path.dirname(entryScript),
    env,
    // stdin is piped (not 'ignore') specifically to hand the proxy
    // credentials to the child process — see the write below. Passing them
    // as env vars instead (the previous approach) would leave them readable
    // by any other process running as the same OS user via /proc or Task
    // Manager for the child's entire lifetime; a one-shot stdin write is
    // only ever visible to the child itself and isn't retained anywhere
    // after it's read (see profileWindowEntry.ts's readStdinCredentials()).
    //
    // The 'ipc' channel (fd 3) is what lets ProfileManager.stop() ask this
    // process to shut down gracefully (app.quit(), which flushes Chromium's
    // cookie/localStorage stores) instead of only ever having a hard kill()
    // available — see profileManager.ts's stop() for why that distinction
    // turned out to matter for real. stdout/stderr stay ignored, same as before.
    stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
    detached: false,
  });

  // Written once, immediately, then the stream is closed — the child reads
  // exactly this one line before doing anything else (see
  // readStdinCredentials() in profileWindowEntry.ts), so there's no window
  // where the child is waiting on more input that never arrives.
  child.stdin?.write(
    JSON.stringify({
      proxyUsername: params.proxy?.username ?? null,
      proxyPassword: params.proxyPassword ?? null,
      automationToken: params.automationToken ?? null,
    }) + '\n',
  );
  child.stdin?.end();

  return child;
}
