import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describeError } from '../../src/renderer/services/errorMessages';
import en from '../../src/renderer/i18n/en';

/**
 * registerIpc.ts's Zod-validation-on-every-channel guarantee had only ever
 * been exercised via unit tests calling the handler function directly with
 * a mocked ipcMain — never through a real IPC round-trip, where Electron's
 * own serialization and its "Error invoking remote method" wrapping happens
 * for real. This sends a genuinely malformed payload through the real
 * `window.profileforge.invoke` bridge (same one reliability.spec.ts already
 * uses for backend-guard scenarios the UI itself can't reach) against a
 * live app, then closes the loop by feeding the exact rejection this
 * produces into the renderer's own describeError() — proving not just that
 * invalid input is rejected, but that a real user would see the intended
 * human-readable banner text, not raw Zod/Electron internals.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-ipc-validation-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

function invokeIpc(win: Page, channel: string, payload: unknown): Promise<unknown> {
  return win.evaluate(
    ([c, p]) => (window as unknown as { profileforge: { invoke: (c: string, p: unknown) => Promise<unknown> } }).profileforge.invoke(c, p),
    [channel, payload] as const,
  );
}

test('a malformed payload on a real (non-mocked) IPC channel is rejected by the real Zod schema, not silently accepted', async () => {
  // groups:create requires { name: string } — send a completely wrong shape.
  await expect(invokeIpc(window, 'groups:create', { name: 12345 })).rejects.toThrow();
});

test('missing a required field on a real IPC channel is also rejected, not defaulted or ignored', async () => {
  await expect(invokeIpc(window, 'groups:create', {})).rejects.toThrow();
});

test('the real rejection message from an invalid IPC payload maps to the intended human-readable banner text', async () => {
  let rawMessage = '';
  try {
    await invokeIpc(window, 'groups:create', { name: 12345 });
    throw new Error('expected the IPC call to reject, but it resolved');
  } catch (err) {
    rawMessage = err instanceof Error ? err.message : String(err);
  }

  // Sanity check: this is a real Electron IPC rejection, not a plain Error
  // thrown in the test itself — it must carry Electron's own wrapper text
  // and a serialized Zod issue, exactly the shape errorMessages.ts's own
  // comment documents having to parse.
  expect(rawMessage).toMatch(/Error invoking remote method/);
  expect(rawMessage).toMatch(/"code":\s*"/);

  const t = (key: keyof typeof en) => en[key];
  const shown = describeError(new Error(rawMessage), t as never);
  expect(shown).toBe(en['errors.invalidInput']);
  // Confirms it's the specific, actionable message — not the fully generic
  // fallback a real user would find useless.
  expect(shown).not.toBe(en['common.unexpectedError']);
});

/**
 * The three tests above only ever exercised `groups:create` — real proof
 * the Zod-validation-on-every-channel MECHANISM works end-to-end, but not
 * proof that every individual channel's own schema actually enforces its
 * own constraints correctly. `IpcRequestSchemas` (contracts.ts) has 63
 * channels; a schema keyed to the wrong shape, or missing a `.min()`/
 * `.max()`/enum constraint it looks like it has, would only ever be caught
 * by exercising that SPECIFIC channel — checked here are real, non-mocked
 * calls against three channels with genuinely different schema shapes
 * (a numeric range bound, an enum, a string length-1 minimum), spanning
 * proxy, settings and profiles channels rather than three more
 * variations on groups:create.
 */
test('proxy:create rejects a port outside the real 1-65535 range, not silently clamped or accepted', async () => {
  await expect(
    invokeIpc(window, 'proxy:create', { name: 'Bad Port', protocol: 'http', host: '127.0.0.1', port: 99999 }),
  ).rejects.toThrow();
});

test('settings:update rejects a theme value outside the real enum, not silently ignored', async () => {
  await expect(invokeIpc(window, 'settings:update', { theme: 'rainbow' })).rejects.toThrow();
});

test('profiles:create rejects an empty name (real min(1) constraint), not silently defaulted', async () => {
  await expect(invokeIpc(window, 'profiles:create', { name: '' })).rejects.toThrow();
});

test('settings:update rejects cacheLimitMb below its real 50MB floor, not silently clamped', async () => {
  await expect(invokeIpc(window, 'settings:update', { cacheLimitMb: 5 })).rejects.toThrow();
});
