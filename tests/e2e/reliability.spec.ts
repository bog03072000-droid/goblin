import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Covers the "must fail gracefully" scenarios from the reliability pass:
 * a blocked destructive action surfaces a clear message rather than
 * crashing or silently no-op'ing, duplicate input doesn't corrupt state,
 * and a profile configured to route through a dead proxy still starts and
 * stops cleanly instead of taking the whole app down with it. */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-reliability-'));
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

test('deleting a running profile is blocked with a clear message, not silently ignored or crashed', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Running Delete Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Running Delete Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  // A single delete no longer confirms first (soft-delete + Undo toast is
  // the safety net now — see profileSoftDelete.spec.ts), so this click goes
  // straight to the backend guard being tested here.
  await row.getByRole('button', { name: 'Delete' }).click();

  // A real, human-readable failure banner — not a raw stack trace, not a
  // silent no-op, and critically: the profile is still there afterwards.
  await expect(window.locator('.banner-error')).toContainText('Stop the profile', { timeout: 10_000 });
  await expect(row).toHaveAttribute('data-status', 'RUNNING');
  await expect(window.locator('td', { hasText: 'E2E Running Delete Profile' })).toBeVisible();

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

  // Now that it's stopped, the exact same action succeeds.
  await row.getByRole('button', { name: 'Delete' }).click();
  await expect(window.locator('td', { hasText: 'E2E Running Delete Profile' })).toHaveCount(0, { timeout: 15_000 });
});

test('duplicate profile names are accepted without corrupting the list (no uniqueness constraint on name)', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Duplicate Name');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  await window.getByPlaceholder('New profile name').fill('E2E Duplicate Name');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();

  await expect(window.locator('td', { hasText: 'E2E Duplicate Name' })).toHaveCount(2, { timeout: 15_000 });

  // Each row is still independently addressable and controllable by its own
  // row despite sharing a display name — proves they're distinct records,
  // not one profile rendered twice or a name collision that merged them.
  const rows = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Duplicate Name' }) });
  await rows.nth(0).getByRole('button', { name: 'Start', exact: true }).click();
  await expect(rows.nth(0)).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
  await expect(rows.nth(1)).toHaveAttribute('data-status', 'STOPPED');

  await rows.nth(0).getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(rows.nth(0)).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

// Deliberately re-investigated with the same exit-code/signal/timing
// diagnostic that root-caused the resourceManagement.spec.ts CRASHED flake
// (see profileManager.ts's child.on('exit', ...) handler and its
// SOFT_DELETE_WINDOW_MS-adjacent comment) — this test's own Start-then-
// immediately-Stop shape is a similarly early stop, and it seemed worth
// checking for the same class of bug rather than assuming clean forever.
// Ran 5x + one preserved-log run: consistently clean (code=0, signal=null,
// aliveMs in the ~550-600ms range every time) — this scenario does NOT
// reproduce the CRASHED flake. The real difference: the flake needed
// restart() specifically (stop the OLD child, spawn a brand NEW one, then
// stop THAT one almost immediately) — a plain single start()-then-stop()
// gives app.quit()'s graceful path enough of a window to complete cleanly
// even at a similarly low aliveMs. No bug found here; recorded so a future
// reader sees this was checked, not assumed.
test('a profile assigned to an unreachable proxy still starts and stops cleanly instead of taking the app down', async () => {
  await window.getByText('Proxies', { exact: true }).click();
  await window.getByPlaceholder('Name', { exact: true }).fill('E2E Dead Proxy');
  await window.getByPlaceholder('Host').fill('127.0.0.1');
  await window.getByPlaceholder('Port').fill('1'); // nothing listens on port 1
  await window.getByRole('button', { name: 'Add Proxy' }).click();
  await expect(window.locator('td', { hasText: 'E2E Dead Proxy' })).toBeVisible({ timeout: 10_000 });

  await window.getByText('Profiles', { exact: true }).click();
  await window.getByPlaceholder('New profile name').fill('E2E Dead Proxy Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Dead Proxy Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('proxy', { exact: true }).click();
  await window.getByLabel('Assigned proxy').selectOption({ label: 'E2E Dead Proxy (http://127.0.0.1:1)' });
  await window.getByRole('button', { name: 'Save' }).click();
  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

  // The manager window itself never went down — still fully interactive.
  await expect(window.getByRole('button', { name: 'Custom setup' })).toBeEnabled();
});

/** Calls a manager IPC channel directly from the renderer's own exposed
 * bridge (the same `window.profileforge.invoke` the real UI uses under the
 * hood) — used below for the two scenarios normal UI interaction can't
 * reach at all (the Start/Stop buttons are swapped based on status, so a
 * real user can never click "Start" on an already-running row through the
 * UI, and likewise for "Stop" on an already-stopped one). This proves the
 * backend guard itself is correct, independent of any UI affordance. */
function invokeIpc(win: Page, channel: string, payload: unknown): Promise<unknown> {
  return win.evaluate(
    ([c, p]) => (window as unknown as { profileforge: { invoke: (c: string, p: unknown) => Promise<unknown> } }).profileforge.invoke(c, p),
    [channel, payload] as const,
  );
}

test('starting an already-running profile is rejected with a specific error, not silently double-started', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Start Twice');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Start Twice' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const profileId = await row.getAttribute('data-profile-id');
  await expect(invokeIpc(window, 'profiles:start', { id: profileId })).rejects.toThrow(/already running/i);
  // Still exactly one running instance — a second start() call must not
  // have spawned a duplicate process for the same profile.
  await expect(row).toHaveAttribute('data-status', 'RUNNING');

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('stopping an already-stopped profile resolves gracefully instead of throwing', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Stop Twice');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Stop Twice' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toHaveAttribute('data-status', 'STOPPED');

  const profileId = await row.getAttribute('data-profile-id');
  const result = (await invokeIpc(window, 'profiles:stop', { id: profileId })) as { status: string };
  expect(result.status).toBe('STOPPED');
});

test('starting a profile whose storage folder was deleted outside the app shows a clear error, not a crash', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Deleted Storage');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Deleted Storage' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  const profileDirs = fs.readdirSync(path.join(userDataDir, 'profiles'));
  const newestDir = profileDirs
    .map((d) => path.join(userDataDir, 'profiles', d))
    .sort((a, b) => fs.statSync(b).birthtimeMs - fs.statSync(a).birthtimeMs)[0]!;
  fs.rmSync(newestDir, { recursive: true, force: true });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(window.locator('.banner-error')).toContainText('storage folder is missing', { timeout: 10_000 });
  // The app itself is still fully usable afterwards — not a crash.
  await expect(window.getByRole('button', { name: 'Custom setup' })).toBeEnabled();
});
