import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import { parseArgs, readStdinCredentials, migrationsDir } from '../../src/main/browser/profileWindowArgs';
import { app } from 'electron';

afterEach(() => {
  vi.restoreAllMocks();
  (app as { isPackaged?: boolean }).isPackaged = false;
});

function baseArgv(overrides: string[] = []): string[] {
  return [
    '--profile-id=p1',
    '--profile-name=My Profile',
    '--user-data-dir=/tmp/data',
    '--user-agent=Mozilla/5.0',
    ...overrides,
  ];
}

describe('parseArgs', () => {
  it('parses the four required fields', () => {
    const args = parseArgs(baseArgv());
    expect(args.profileId).toBe('p1');
    expect(args.profileName).toBe('My Profile');
    expect(args.userDataDir).toBe('/tmp/data');
    expect(args.userAgent).toBe('Mozilla/5.0');
  });

  it.each(['--profile-id=', '--profile-name=', '--user-data-dir=', '--user-agent='])(
    'throws when the %s flag is missing from argv',
    (prefix) => {
      const argv = baseArgv().filter((a) => !a.startsWith(prefix));
      expect(() => parseArgs(argv)).toThrow('Missing required profile window arguments');
    },
  );

  it('defaults locale to "en-US" when not provided', () => {
    expect(parseArgs(baseArgv()).locale).toBe('en-US');
  });

  it('uses the provided locale when given', () => {
    expect(parseArgs(baseArgv(['--locale=uk-UA'])).locale).toBe('uk-UA');
  });

  it('defaults proxyRules/dbPath/navigateTo/automationPort to null when absent', () => {
    const args = parseArgs(baseArgv());
    expect(args.proxyRules).toBeNull();
    expect(args.dbPath).toBeNull();
    expect(args.navigateTo).toBeNull();
    expect(args.automationPort).toBeNull();
  });

  it('always returns null proxyUsername/proxyPassword regardless of argv — filled in later via stdin, never argv', () => {
    const args = parseArgs(baseArgv(['--proxy-rules=1.2.3.4:8080']));
    expect(args.proxyUsername).toBeNull();
    expect(args.proxyPassword).toBeNull();
    expect(args.proxyRules).toBe('1.2.3.4:8080');
  });

  it('decodes a valid base64-encoded JSON fingerprint-config', () => {
    const config = { canvasMode: 'noise', hardwareConcurrency: 8 };
    const b64 = Buffer.from(JSON.stringify(config), 'utf-8').toString('base64');
    const args = parseArgs(baseArgv([`--fingerprint-config=${b64}`]));
    expect(args.fingerprintConfig).toEqual(config);
  });

  it('falls back to an empty object when fingerprint-config is not valid base64-JSON', () => {
    const args = parseArgs(baseArgv(['--fingerprint-config=not-valid-base64-json!!!']));
    expect(args.fingerprintConfig).toEqual({});
  });

  it('defaults fingerprintConfig to an empty object when the flag is absent entirely', () => {
    expect(parseArgs(baseArgv()).fingerprintConfig).toEqual({});
  });

  it('parses a valid positive integer automation-port', () => {
    expect(parseArgs(baseArgv(['--automation-port=5555'])).automationPort).toBe(5555);
  });

  it.each(['0', '-1', 'not-a-number', '3.5'])('treats automation-port=%s as absent (null)', (value) => {
    expect(parseArgs(baseArgv([`--automation-port=${value}`])).automationPort).toBeNull();
  });

  it('defaults extensionPaths to an empty array when the flag is absent', () => {
    expect(parseArgs(baseArgv()).extensionPaths).toEqual([]);
  });

  it('decodes a valid base64-encoded JSON array of extension paths', () => {
    const paths = ['C:\\ext\\one', 'C:\\ext\\two'];
    const b64 = Buffer.from(JSON.stringify(paths), 'utf-8').toString('base64');
    expect(parseArgs(baseArgv([`--extension-paths=${b64}`])).extensionPaths).toEqual(paths);
  });

  it('falls back to an empty array when extension-paths is not valid base64-JSON', () => {
    expect(parseArgs(baseArgv(['--extension-paths=not-valid!!!'])).extensionPaths).toEqual([]);
  });

  it('drops non-string entries from a malformed extension-paths array instead of throwing', () => {
    const b64 = Buffer.from(JSON.stringify(['/real/path', 42, null, '/other/path']), 'utf-8').toString('base64');
    expect(parseArgs(baseArgv([`--extension-paths=${b64}`])).extensionPaths).toEqual(['/real/path', '/other/path']);
  });

  it('returns an empty array when the decoded JSON is not an array at all', () => {
    const b64 = Buffer.from(JSON.stringify({ not: 'an array' }), 'utf-8').toString('base64');
    expect(parseArgs(baseArgv([`--extension-paths=${b64}`])).extensionPaths).toEqual([]);
  });
});

describe('readStdinCredentials', () => {
  it('returns all-null immediately when stdin is a TTY, without reading it', () => {
    const spy = vi.spyOn(fs, 'readFileSync');
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const result = readStdinCredentials();
    expect(result).toEqual({ proxyUsername: null, proxyPassword: null, automationToken: null });
    expect(spy).not.toHaveBeenCalled();
    Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
  });

  it('parses a valid JSON line from fd 0 into the three credential fields', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      JSON.stringify({ proxyUsername: 'u', proxyPassword: 'p', automationToken: 't' }) + '\n',
    );
    expect(readStdinCredentials()).toEqual({ proxyUsername: 'u', proxyPassword: 'p', automationToken: 't' });
  });

  it('fills missing fields in a partial JSON object with null', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ proxyUsername: 'u' }));
    expect(readStdinCredentials()).toEqual({ proxyUsername: 'u', proxyPassword: null, automationToken: null });
  });

  it('returns all-null when stdin is not a TTY but the read throws (e.g. no data piped)', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    vi.spyOn(fs, 'readFileSync').mockImplementation(() => {
      throw new Error('EAGAIN');
    });
    expect(readStdinCredentials()).toEqual({ proxyUsername: null, proxyPassword: null, automationToken: null });
  });

  it('returns all-null when the piped data is not valid JSON', () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    vi.spyOn(fs, 'readFileSync').mockReturnValue('not json at all');
    expect(readStdinCredentials()).toEqual({ proxyUsername: null, proxyPassword: null, automationToken: null });
  });
});

describe('migrationsDir', () => {
  it('resolves under process.resourcesPath when packaged', () => {
    (app as { isPackaged?: boolean }).isPackaged = true;
    (process as { resourcesPath?: string }).resourcesPath = '/fake/resources';
    expect(migrationsDir().replace(/\\/g, '/')).toBe('/fake/resources/database/migrations');
    delete (process as { resourcesPath?: string }).resourcesPath;
  });

  it('resolves relative to __dirname when not packaged (dev mode)', () => {
    (app as { isPackaged?: boolean }).isPackaged = false;
    expect(migrationsDir().replace(/\\/g, '/')).toMatch(/database\/migrations$/);
  });
});
