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
