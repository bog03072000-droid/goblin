import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ProxyRecord } from '../../src/shared/schemas/proxy';
import type { Fingerprint } from '../../src/shared/schemas/fingerprint';

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  stdin = { write: vi.fn(), end: vi.fn() };
  kill = vi.fn();
}

let lastSpawnCall: { command: string; args: string[]; options: Record<string, unknown> } | undefined;
let lastChild: FakeChildProcess;

vi.mock('node:child_process', () => ({
  spawn: vi.fn((command: string, args: string[], options: Record<string, unknown>) => {
    lastSpawnCall = { command, args, options };
    lastChild = new FakeChildProcess();
    return lastChild;
  }),
}));

const { launchProfileProcess, isTransientSpawnError } = await import('../../src/main/browser/browserLauncher');

afterEach(() => {
  vi.clearAllMocks();
});

function makeFingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    userAgent: 'Mozilla/5.0 Test UA',
    platform: 'Win32',
    locale: 'en-US',
    languages: ['en-US', 'en'],
    timezone: 'America/New_York',
    screenWidth: 1920,
    screenHeight: 1080,
    deviceScaleFactor: 1,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    webglVendor: 'Google Inc.',
    webglRenderer: 'ANGLE',
    webrtcMode: 'default',
    canvasMode: 'off',
    audioMode: 'off',
    fontsMode: 'system',
    mediaDevicesMode: 'real',
    webglSpoofingMode: 'off',
    geolocationMode: 'real',
    geolocationLatitude: 0,
    geolocationLongitude: 0,
    permissionsMode: 'real',
    serviceWorkerMode: 'disabled',
    seed: 'test-seed',
    ...overrides,
  } as Fingerprint;
}

function makeProxy(overrides: Partial<ProxyRecord> = {}): ProxyRecord {
  return {
    id: 'proxy-1',
    name: 'My Proxy',
    protocol: 'http',
    host: '1.2.3.4',
    port: 8080,
    username: 'proxyuser',
    lastCheckStatus: null,
    lastCheckedAt: null,
    lastCheckLatencyMs: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  } as ProxyRecord;
}

describe('launchProfileProcess', () => {
  it('spawns the real electron binary (process.execPath) with --profile-window and the core args', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'My Profile',
      userDataDir: '/data/p1',
      fingerprint: makeFingerprint(),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db/app.sqlite',
    });

    expect(lastSpawnCall!.command).toBe(process.execPath);
    expect(lastSpawnCall!.args).toContain('--profile-window');
    // Real, measured ~15% per-profile RAM reduction (docs/LOAD_TEST.md's
    // "Update (2026-09-06)" section) — verified against a real Electron
    // build to not regress fingerprint behavior before being added here.
    expect(lastSpawnCall!.args).toContain('--in-process-gpu');
    expect(lastSpawnCall!.args).toContain('--profile-id=p1');
    expect(lastSpawnCall!.args).toContain('--profile-name=My Profile');
    expect(lastSpawnCall!.args).toContain('--user-data-dir=/data/p1');
    expect(lastSpawnCall!.args).toContain('--user-agent=Mozilla/5.0 Test UA');
    expect(lastSpawnCall!.args).toContain('--locale=en-US');
    expect(lastSpawnCall!.args).toContain('--db-path=/db/app.sqlite');
  });

  it('does not include --navigate-to or --automation-port when neither is set', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
    });
    expect(lastSpawnCall!.args.some((a) => a.startsWith('--navigate-to='))).toBe(false);
    expect(lastSpawnCall!.args.some((a) => a.startsWith('--automation-port='))).toBe(false);
  });

  it('includes --navigate-to when initialUrl is set (Downloads page re-download)', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
      initialUrl: 'https://example.com/file.zip',
    });
    expect(lastSpawnCall!.args).toContain('--navigate-to=https://example.com/file.zip');
  });

  it('includes --automation-port only when it is a truthy value', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
      automationPort: 5555,
    });
    expect(lastSpawnCall!.args).toContain('--automation-port=5555');
  });

  it('encodes the fingerprint config as base64 JSON containing the configured fields', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint({ timezone: 'Europe/Berlin', hardwareConcurrency: 16 }),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
    });
    const configArg = lastSpawnCall!.args.find((a) => a.startsWith('--fingerprint-config='))!;
    const b64 = configArg.slice('--fingerprint-config='.length);
    const decoded = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    expect(decoded.timezone).toBe('Europe/Berlin');
    expect(decoded.hardwareConcurrency).toBe(16);
  });

  it('a bare host:port proxy-rules covers both http and https (no scheme prefix) for http/https proxies', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: makeProxy({ protocol: 'http', host: '1.2.3.4', port: 8080 }),
      proxyPassword: 'secret',
      dbPath: '/db',
    });
    expect(lastSpawnCall!.args).toContain('--proxy-rules=1.2.3.4:8080');
  });

  it('a socks5 proxy gets an explicit socks5:// scheme prefix', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: makeProxy({ protocol: 'socks5', host: '5.6.7.8', port: 1080 }),
      proxyPassword: null,
      dbPath: '/db',
    });
    expect(lastSpawnCall!.args).toContain('--proxy-rules=socks5://5.6.7.8:1080');
  });

  it('omits --proxy-rules entirely when there is no proxy', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
    });
    expect(lastSpawnCall!.args.some((a) => a.startsWith('--proxy-rules='))).toBe(false);
  });

  it('sets TZ in the child env to the fingerprint timezone', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint({ timezone: 'Asia/Tokyo' }),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
    });
    expect((lastSpawnCall!.options['env'] as NodeJS.ProcessEnv)['TZ']).toBe('Asia/Tokyo');
  });

  it('writes proxy credentials and automation token to stdin as one JSON line, then closes it', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: makeProxy({ username: 'proxyuser' }),
      proxyPassword: 'proxypass',
      dbPath: '/db',
      automationToken: 'tok123',
    });
    expect(lastChild.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ proxyUsername: 'proxyuser', proxyPassword: 'proxypass', automationToken: 'tok123' }) + '\n',
    );
    expect(lastChild.stdin.end).toHaveBeenCalledTimes(1);
  });

  it('writes null credentials when there is no proxy and no automation token', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
    });
    expect(lastChild.stdin.write).toHaveBeenCalledWith(
      JSON.stringify({ proxyUsername: null, proxyPassword: null, automationToken: null }) + '\n',
    );
  });

  it('never passes proxy credentials as CLI args (only via stdin)', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: makeProxy({ username: 'topsecretuser' }),
      proxyPassword: 'topsecretpass',
      dbPath: '/db',
    });
    expect(lastSpawnCall!.args.join(' ')).not.toContain('topsecretuser');
    expect(lastSpawnCall!.args.join(' ')).not.toContain('topsecretpass');
  });

  it('pipes stdin, ignores stdout/stderr, and opens an ipc channel', () => {
    launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
    });
    expect(lastSpawnCall!.options['stdio']).toEqual(['pipe', 'ignore', 'ignore', 'ipc']);
    expect(lastSpawnCall!.options['detached']).toBe(false);
  });

  it('returns the spawned child process', () => {
    const child = launchProfileProcess({
      profileId: 'p1',
      profileName: 'p',
      userDataDir: '/d',
      fingerprint: makeFingerprint(),
      proxy: null,
      proxyPassword: null,
      dbPath: '/db',
    });
    expect(child).toBe(lastChild);
  });
});

describe('isTransientSpawnError', () => {
  it.each(['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM'])('treats %s as transient', (code) => {
    expect(isTransientSpawnError(Object.assign(new Error('x'), { code }))).toBe(true);
  });

  it.each(['ENOENT', 'EACCES', undefined])('treats %s as not transient', (code) => {
    expect(isTransientSpawnError(Object.assign(new Error('x'), { code }))).toBe(false);
  });

  it('returns false for a non-Error value', () => {
    expect(isTransientSpawnError('not an error')).toBe(false);
    expect(isTransientSpawnError(undefined)).toBe(false);
  });
});
