import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const COOKIE_REMOTE_DEBUG_PORT = 9336;

/**
 * Separate from profileLifecycle.spec.ts because this test actually spawns a
 * second, independent Electron/Chromium OS process (see ARCHITECTURE.md) for
 * the profile being started — slower and more environment-sensitive than the
 * CRUD-only suite, so it's kept isolated and given a longer timeout rather
 * than risking flakiness in the main suite.
 */
test.setTimeout(90_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-browser-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(COOKIE_REMOTE_DEBUG_PORT) },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

/** Same CDP-connection pattern as browserTabs.spec.ts's connectToShell() —
 * duplicated locally (not imported) since these are independent Playwright
 * test files/processes and each needs its own debug port + connection. */
let cdp: Browser | undefined;
async function connectToShell(): Promise<Page> {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      cdp = await chromium.connectOverCDP(`http://127.0.0.1:${COOKIE_REMOTE_DEBUG_PORT}`);
      for (const ctx of cdp.contexts()) {
        for (const page of ctx.pages()) {
          if (page.url().includes('browser-shell.html')) return page;
        }
      }
      await cdp.close();
      cdp = undefined;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Could not find browser-shell.html page via CDP: ${String(lastErr)}`);
}

/** See browserTabs.spec.ts's identical helper for why this retries: a
 * `<webview>`'s executeJavaScript can transiently fail with
 * GUEST_VIEW_MANAGER_CALL right after a navigation commits but before the
 * guest frame is actually ready to run injected script. */
async function execInWebview(webview: ReturnType<Page['locator']>, script: string): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < 10; i++) {
    try {
      return await webview.evaluate(
        (el, s) => (el as unknown as { executeJavaScript: (s: string) => Promise<unknown> }).executeJavaScript(s),
        script,
      );
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastErr;
}

test('starting a profile launches a real per-profile browser process and stopping it tears it down', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Browser Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Browser Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();

  // Starting spawns a real second Electron/Chromium OS process — give it real time.
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const profileDataDir = fs.readdirSync(userDataDir).find((f) => f === 'profiles');
  expect(profileDataDir).toBeTruthy();
  const profileDirs = fs.readdirSync(path.join(userDataDir, 'profiles'));
  expect(profileDirs.length).toBeGreaterThan(0);
  const browserDataDir = path.join(userDataDir, 'profiles', profileDirs[0]!, 'browser-data');
  // The per-profile child process sets this as its own Electron userData dir;
  // Chromium creates "Local State" there once the process is actually up.
  await expect
    .poll(() => fs.existsSync(browserDataDir), { timeout: 20_000 })
    .toBe(true);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('restarting a profile tears down the old process, spawns a genuinely new one, and preserves storage', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Restart Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Restart Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  // Resolve this profile's directory by picking the most recently created one
  // (this test runs after "starting a profile..." already created one).
  const profileDirs = fs.readdirSync(path.join(userDataDir, 'profiles'));
  const thisProfileDir = profileDirs
    .map((d) => path.join(userDataDir, 'profiles', d))
    .sort((a, b) => fs.statSync(b).birthtimeMs - fs.statSync(a).birthtimeMs)[0]!;

  const lockPath = path.join(thisProfileDir, 'profile.lock');
  await expect.poll(() => fs.existsSync(lockPath), { timeout: 15_000 }).toBe(true);
  const firstLockPid = (JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid: number }).pid;

  // A real, independently-verifiable persistence marker — not a stand-in.
  const markerPath = path.join(thisProfileDir, 'browser-data', 'e2e-restart-marker.txt');
  fs.writeFileSync(markerPath, 'persisted-across-restart');

  await row.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  // Poll for the PID to actually change, not just for the lock file to
  // exist — it exists continuously across a restart (old lock is released
  // and a new one acquired), so checking mere existence right after clicking
  // Restart can race and read the still-live old lock before the new one
  // lands, rather than proving a new OS process. Polling until the value
  // itself differs from the first reading is what actually proves it.
  const readPid = (): number | null => {
    if (!fs.existsSync(lockPath)) return null;
    try {
      return (JSON.parse(fs.readFileSync(lockPath, 'utf-8')) as { pid: number }).pid;
    } catch {
      return null;
    }
  };
  const readDifferentPid = (): number | string => {
    const pid = readPid();
    return pid !== null && pid !== firstLockPid ? pid : 'unchanged';
  };
  await expect.poll(readDifferentPid, { timeout: 30_000 }).not.toBe('unchanged');
  const secondLockPid = readPid();
  expect(secondLockPid).not.toBeNull();
  expect(secondLockPid).not.toBe(firstLockPid);

  expect(fs.existsSync(markerPath)).toBe(true);
  expect(fs.readFileSync(markerPath, 'utf-8')).toBe('persisted-across-restart');

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

// RESOLVED (previously fixme'd as a known gap). Root cause was NOT the
// shutdown path — a throwaway diagnostic script instrumenting the
// 'graceful-quit' IPC handler directly confirmed the message reaches the
// child, app.quit() runs, and before-quit/will-quit both fire, and that the
// cookie genuinely lands in the on-disk Cookies SQLite file under the
// profile's own session partition every time. The actual bug was on the
// READ side, after restart: a freshly-started process's cookie store loads
// its on-disk backing file into memory asynchronously, and the address bar
// updating (which fires on 'did-navigate', i.e. navigation commit) doesn't
// guarantee that load has finished — so reading document.cookie immediately
// afterward could race ahead of it and observe an empty jar even though the
// cookie was genuinely persisted. Fixed by polling the read instead of
// reading once (see expect.poll below) — confirmed stable across 4
// consecutive isolated runs after the fix, having reliably failed 3/3 times
// before it.
/** Writes to all three of Chromium's persistent per-origin storage
 * mechanisms and reads them back via the webview's own executeJavaScript. */
async function setAllStorage(webview: ReturnType<Page['locator']>): Promise<void> {
  await execInWebview(webview, `document.cookie = "e2e_restart_persist=yes; path=/; max-age=3600"`);
  await execInWebview(webview, `localStorage.setItem('e2e_restart_persist', 'yes')`);
  await execInWebview(
    webview,
    `new Promise((resolve, reject) => {
      const req = indexedDB.open('e2e_restart_persist_db', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('store');
      req.onsuccess = () => {
        const tx = req.result.transaction('store', 'readwrite');
        tx.objectStore('store').put('yes', 'key');
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    })`,
  );
}

async function readAllStorage(webview: ReturnType<Page['locator']>): Promise<{ cookie: string; localStorage: unknown; indexedDb: unknown }> {
  const cookie = String(await execInWebview(webview, 'document.cookie'));
  const ls = await execInWebview(webview, `localStorage.getItem('e2e_restart_persist')`);
  const idb = await execInWebview(
    webview,
    `new Promise((resolve, reject) => {
      const req = indexedDB.open('e2e_restart_persist_db', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('store');
      req.onsuccess = () => {
        const tx = req.result.transaction('store', 'readonly');
        const getReq = tx.objectStore('store').get('key');
        getReq.onsuccess = () => resolve(getReq.result ?? null);
        getReq.onerror = () => reject(getReq.error);
      };
      req.onerror = () => reject(req.error);
    })`,
  );
  return { cookie, localStorage: ls, indexedDb: idb };
}

test('a persistent cookie, localStorage, and IndexedDB value set before restart are all still there after restart', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Cookie Restart Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Cookie Restart Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  let shell = await connectToShell();
  const address = shell.locator('#address');
  await address.fill('https://example.com');
  await address.press('Enter');
  await expect(address).toHaveValue(/example\.com/, { timeout: 15_000 });

  let webview = shell.locator('webview').first();
  await webview.waitFor({ state: 'attached', timeout: 15_000 });
  await setAllStorage(webview);
  const before = await readAllStorage(webview);
  expect(before.cookie).toContain('e2e_restart_persist=yes');
  expect(before.localStorage).toBe('yes');
  expect(before.indexedDb).toBe('yes');

  await cdp?.close();
  cdp = undefined;

  await row.getByRole('button', { name: 'Restart', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  shell = await connectToShell();
  // The restarted profile auto-navigates to the normal start page, not back
  // to example.com — re-navigate there to read what Chromium actually
  // persisted to disk for that origin under this profile's session partition.
  const addressAfter = shell.locator('#address');
  await addressAfter.fill('https://example.com');
  await addressAfter.press('Enter');
  await expect(addressAfter).toHaveValue(/example\.com/, { timeout: 15_000 });
  webview = shell.locator('webview').first();
  await webview.waitFor({ state: 'attached', timeout: 15_000 });

  // A freshly-started process's storage backends load their on-disk backing
  // files into memory asynchronously — the address bar updating (on
  // 'did-navigate', which fires on commit) doesn't guarantee that load has
  // finished yet, so an immediate read can legitimately observe empty
  // storage for a moment even though everything is genuinely on disk. Poll
  // instead of reading once.
  await expect
    .poll(async () => readAllStorage(webview), { timeout: 10_000, intervals: [250, 500, 1_000] })
    .toEqual({ cookie: expect.stringContaining('e2e_restart_persist=yes'), localStorage: 'yes', indexedDb: 'yes' });

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
