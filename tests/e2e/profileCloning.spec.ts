import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Profile cloning had solid file-level coverage already (see
 * tests/integration/profileIsolation.test.ts's "full clone copies storage...
 * config clone does not") but zero E2E coverage of what a real user actually
 * does: click Clone in the manager UI, then verify the result. The manager
 * UI's Clone button always uses mode:'config' (see ProfilesPage.tsx's
 * cloneOne()) — 'full' mode exists and is unit-tested but isn't reachable
 * from the UI at all, so this file covers the path real users take.
 */
const REMOTE_DEBUG_PORT = 9337;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-clone-'));
  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en', PF_E2E_REMOTE_DEBUG_PORT: String(REMOTE_DEBUG_PORT) },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  await cdp?.close();
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

/** `<webview>.executeJavaScript` can transiently fail with
 * GUEST_VIEW_MANAGER_CALL right after a navigation commits but before the
 * guest frame is actually ready to run injected script — see the identical
 * helper (and its full explanation) in browserTabs.spec.ts. */
async function execInWebview(webview: ReturnType<Page['locator']>, script: string): Promise<unknown> {
  let lastErr: unknown;
  for (let i = 0; i < 20; i++) {
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

test('cloning a profile copies its config (proxy/group/tags/fingerprint identity) and gets independent storage', async () => {
  await window.getByText('Proxies', { exact: true }).click();
  await window.getByPlaceholder('Name', { exact: true }).fill('Clone Test Proxy');
  await window.getByPlaceholder('Host').fill('127.0.0.1');
  await window.getByPlaceholder('Port').fill('8082');
  await window.getByRole('button', { name: 'Add Proxy' }).click();
  await expect(window.locator('td', { hasText: 'Clone Test Proxy' })).toBeVisible({ timeout: 10_000 });
  await window.getByText('Profiles', { exact: true }).click();

  await window.getByRole('button', { name: 'Manage Groups' }).click();
  const groupModal = window.locator('.modal-panel');
  await groupModal.getByPlaceholder('New group name').fill('Clone Test Group');
  await groupModal.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(groupModal.locator('text=Clone Test Group')).toBeVisible({ timeout: 10_000 });
  await window.getByRole('button', { name: 'Close', exact: true }).click();

  // Source profile with a real proxy/group/tag and its own fingerprint.
  await window.getByPlaceholder('New profile name').fill('Clone Source');
  await window.locator('select[title="Move to group…"]').selectOption({ label: 'Clone Test Group' });
  await window.locator('select[title="Proxy"]').selectOption({ label: 'Clone Test Proxy' });
  await window.getByPlaceholder('Tags (comma-separated)').fill('clone-tag');
  await window.getByRole('button', { name: 'New Profile' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  // Exact match: "Clone Source" is also a substring of "Clone Source
  // (clone)", which a plain substring hasText filter would match too once
  // the clone row exists, tripping Playwright's strict mode.
  const sourceRow = window.locator('tr', { has: window.locator('td', { hasText: /^Clone Source$/ }) });
  await expect(sourceRow).toBeVisible({ timeout: 15_000 });

  await sourceRow.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('fingerprint', { exact: true }).click();
  const sourceUserAgent = await window
    .locator('tr', { has: window.locator('th', { hasText: 'User-Agent' }) })
    .locator('td')
    .textContent();
  await window.getByRole('button', { name: 'Close' }).click();

  // Clone via the real per-row Clone button (mode: 'config' — the only path
  // a real user has).
  await sourceRow.getByRole('button', { name: 'Clone' }).click();
  const cloneRow = window.locator('tr', { has: window.locator('td', { hasText: 'Clone Source (clone)' }) });
  await expect(cloneRow).toBeVisible({ timeout: 15_000 });

  // Config copied: same proxy, same group, same tag.
  await expect(cloneRow.locator('td', { hasText: 'Clone Test Proxy' })).toBeVisible();
  await expect(cloneRow.locator('td', { hasText: 'Clone Test Group' })).toBeVisible();
  await expect(cloneRow.locator('.tag', { hasText: 'clone-tag' })).toBeVisible();

  // Fingerprint identity (User-Agent) is carried over verbatim — cloning
  // means "another instance of this same apparent browser/device", not a
  // brand-new random one; only the internal seed (canvas/audio noise) differs.
  await cloneRow.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('fingerprint', { exact: true }).click();
  const cloneUserAgent = await window
    .locator('tr', { has: window.locator('th', { hasText: 'User-Agent' }) })
    .locator('td')
    .textContent();
  expect(cloneUserAgent).toBe(sourceUserAgent);
  await window.getByRole('button', { name: 'Close' }).click();

  // "Clone Test Proxy" points at a made-up port nothing is actually
  // listening on — fine for verifying the label copies across (checked
  // above), but if left assigned while we actually START this profile and
  // navigate real traffic, every request dies against that dead proxy and
  // the webview lands on a Chromium error page instead of example.com,
  // where executeJavaScript behaves unreliably. Unassign before starting —
  // real proxy *routing* is proxyVerification.spec.ts/proxyIsolation.spec.ts's
  // job, not this test's.
  await cloneRow.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('proxy', { exact: true }).click();
  await window.getByLabel('Assigned proxy').selectOption({ label: 'None' });
  await window.getByRole('button', { name: 'Save' }).click();
  await window.getByRole('button', { name: 'Close' }).click();

  // Behavioral storage independence: start the clone, set a cookie, confirm
  // starting the ORIGINAL never sees it (same real-partition-isolation
  // mechanism already proven generally in browserTabs.spec.ts, exercised
  // here specifically across a clone/source pair).
  await cloneRow.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(cloneRow).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  let shell = await connectToShell();
  await shell.locator('#address').fill('https://example.com');
  await shell.locator('#address').press('Enter');
  await expect(shell.locator('#address')).toHaveValue(/example\.com/, { timeout: 15_000 });
  const cloneWebview = shell.locator('webview').first();
  await cloneWebview.waitFor({ state: 'attached', timeout: 15_000 });
  // Give the guest frame a moment past navigation-commit before the first
  // executeJavaScript attempt — cuts down on retries needed for the
  // transient GUEST_VIEW_MANAGER_CALL failure execInWebview otherwise
  // absorbs (see its own comment for why that happens at all).
  await shell.waitForTimeout(1_000);
  const cookieOnClone = await execInWebview(cloneWebview, 'document.cookie = "clone_isolation_test=cloneOnly; path=/"; document.cookie');
  expect(String(cookieOnClone)).toContain('clone_isolation_test=cloneOnly');

  await cloneRow.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(cloneRow).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  await cdp?.close();
  cdp = undefined;

  // Same reason as the clone above: unassign the dead proxy before starting.
  await sourceRow.getByRole('button', { name: 'Edit' }).click();
  await window.getByText('proxy', { exact: true }).click();
  await window.getByLabel('Assigned proxy').selectOption({ label: 'None' });
  await window.getByRole('button', { name: 'Save' }).click();
  await window.getByRole('button', { name: 'Close' }).click();

  await sourceRow.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(sourceRow).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  shell = await connectToShell();
  await shell.locator('#address').fill('https://example.com');
  await shell.locator('#address').press('Enter');
  await expect(shell.locator('#address')).toHaveValue(/example\.com/, { timeout: 15_000 });
  const sourceWebview = shell.locator('webview').first();
  await sourceWebview.waitFor({ state: 'attached', timeout: 15_000 });
  await shell.waitForTimeout(1_000);
  const cookieOnSource = await execInWebview(sourceWebview, 'document.cookie');
  expect(String(cookieOnSource)).not.toContain('clone_isolation_test');

  await sourceRow.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(sourceRow).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
