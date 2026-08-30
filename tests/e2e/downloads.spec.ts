import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * Proves real Electron download handling end to end: a deterministic local
 * HTTP server serves a file with Content-Disposition: attachment, the test
 * drives the actual per-profile browser window (via CDP — see
 * browserTabs.spec.ts for why that's necessary) to navigate to it, and then
 * verifies both the UI's Downloads panel AND the file's real presence on
 * disk under this specific profile's own storage directory. A second test
 * covers the newer, separate concern: that the SAME completed download also
 * gets persisted to the shared SQLite database and shows up — with working
 * history actions (search/delete) — in the manager UI's Downloads page.
 */
test.setTimeout(90_000);

const REMOTE_DEBUG_PORT = 9334;
const FILE_CONTENT = 'profileforge-e2e-download-marker';
const FILE_NAME = 'e2e-marker.txt';

function startFileServer(): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {
      'content-type': 'text/plain',
      'content-disposition': `attachment; filename="${FILE_NAME}"`,
    });
    res.end(FILE_CONTENT);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port }));
  });
}

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;
let fileServer: http.Server;

test.beforeAll(async () => {
  const started = await startFileServer();
  fileServer = started.server;
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-downloads-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      PF_E2E_LOCALE: 'en',
      PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT),
      PF_E2E_PROXY_TEST_URL: `http://127.0.0.1:${started.port}/`,
    },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await cdp?.close();
  await app.close();
  fileServer.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

async function connectToShell(): Promise<Page> {
  let lastErr: unknown;
  for (let i = 0; i < 30; i++) {
    try {
      cdp = await chromium.connectOverCDP(`http://127.0.0.1:${REMOTE_DEBUG_PORT}`);
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

test('a real download is detected, saved under the profile\'s own storage, and shown in the Downloads panel', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Downloads Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Downloads Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  // PF_E2E_PROXY_TEST_URL (reused here purely as "first navigation target",
  // same mechanism proxyVerification.spec.ts uses) makes the profile's first
  // tab request our file server directly, immediately triggering a real
  // Content-Disposition: attachment download on first launch.
  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const shell = await connectToShell();

  await expect(shell.locator('.download-item')).toHaveCount(1, { timeout: 20_000 });
  await expect(shell.locator('.download-status').first()).toContainText('completed', { timeout: 20_000 });
  await expect(shell.locator('.download-name').first()).toContainText(FILE_NAME);

  // The badge only counts in-flight downloads — a completed one shouldn't
  // leave a stale "active" count behind.
  await expect(shell.locator('#downloads-badge')).toBeHidden();

  // Real file, in this profile's own directory — never the manager's
  // userDataDir, never another profile's.
  const profileDirsBeforeStop = fs.readdirSync(path.join(userDataDir, 'profiles'));
  expect(profileDirsBeforeStop.length).toBeGreaterThan(0);
  const downloadsDir = path.join(userDataDir, 'profiles', profileDirsBeforeStop[0]!, 'browser-data', 'downloads');
  await expect.poll(() => fs.existsSync(downloadsDir), { timeout: 10_000 }).toBe(true);
  const files = fs.readdirSync(downloadsDir);
  expect(files).toContain(FILE_NAME);
  expect(fs.readFileSync(path.join(downloadsDir, FILE_NAME), 'utf-8')).toBe(FILE_CONTENT);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});

test('the same completed download is persisted to SQLite and shows up in the manager Downloads history page', async () => {
  const profilesRoot = path.join(userDataDir, 'profiles');
  const dirsBefore = new Set(fs.readdirSync(profilesRoot));

  await window.getByPlaceholder('New profile name').fill('E2E Downloads History Profile');
  await window.getByRole('button', { name: 'New Profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Downloads History Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  // Give the child process time to download the file and record it to the
  // shared DB (see profileWindowEntry.ts's `recordDownload()`) before
  // stopping — recording happens synchronously in the 'done' handler, well
  // before shutdown, so this is generous rather than tight timing.
  const newDirs = () => fs.readdirSync(profilesRoot).filter((d) => !dirsBefore.has(d));
  await expect.poll(() => newDirs().length, { timeout: 15_000 }).toBeGreaterThan(0);
  const downloadedFile = path.join(profilesRoot, newDirs()[0]!, 'browser-data', 'downloads', FILE_NAME);
  await expect.poll(() => fs.existsSync(downloadedFile), { timeout: 15_000 }).toBe(true);
  await window.waitForTimeout(1_000);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

  await window.getByText('Downloads', { exact: true }).click();
  // Both this test's download and the previous test's share the same
  // filename (same file server) — filter on profile name too so the row is
  // uniquely identified regardless of list order or the other row's presence.
  const downloadRow = window.locator('tr', {
    has: window.locator('td', { hasText: FILE_NAME }),
    hasText: 'E2E Downloads History Profile',
  });
  await expect(downloadRow).toBeVisible({ timeout: 15_000 });
  await expect(downloadRow.getByText('Completed')).toBeVisible();

  // Search filter narrows the list down to the matching entry.
  await window.getByPlaceholder('Search by filename...').fill(FILE_NAME);
  await expect(downloadRow).toBeVisible();
  await window.getByPlaceholder('Search by filename...').fill('no-such-file-xyz');
  await expect(window.getByText('No downloads match the current filters.')).toBeVisible();
  await window.getByPlaceholder('Search by filename...').fill('');

  // Delete from history removes the row without touching the file on disk.
  expect(fs.existsSync(downloadedFile)).toBe(true);
  window.once('dialog', (dialog) => void dialog.accept());
  await downloadRow.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(downloadRow).not.toBeVisible({ timeout: 10_000 });
  expect(fs.existsSync(downloadedFile)).toBe(true);
});
