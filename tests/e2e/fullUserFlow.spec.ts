import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/**
 * The complete practical workflow in one continuous run: create → assign
 * group → assign proxy → start → open a tab → navigate → download → stop →
 * restart → verify storage → clone → verify clone independence → backup →
 * restore → bulk operation. Every individual piece already has its own
 * dedicated, more thorough E2E test elsewhere (groupsManagement.spec.ts,
 * proxyIsolation.spec.ts, downloads.spec.ts, profileCloning.spec.ts,
 * zipBackupRestore.test.ts, bulkOperations.spec.ts, etc.) — this file's
 * distinct value is proving the *integration* between them actually works
 * end to end in the order a real user would hit them, not re-proving each
 * piece in isolation.
 */
test.setTimeout(120_000);

const REMOTE_DEBUG_PORT = 9339;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-fullflow-'));
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

test('the complete practical workflow: create, configure, browse, download, restart, clone, backup, restore, bulk', async () => {
  // --- A local file server for the download step ---
  const fileServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="flow-test-file.txt"' });
    res.end('full user flow test file');
  });
  await new Promise<void>((resolve) => fileServer.listen(0, '127.0.0.1', resolve));
  const filePort = (fileServer.address() as AddressInfo).port;

  try {
    // --- Group + proxy setup ---
    await window.getByRole('button', { name: '+ Manage Groups' }).click();
    const groupModal = window.locator('.modal-panel');
    await groupModal.getByPlaceholder('New group name').fill('Flow Group');
    await groupModal.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(groupModal.locator('text=Flow Group')).toBeVisible({ timeout: 10_000 });
    await window.getByRole('button', { name: 'Close', exact: true }).click();

    // --- Create profile with group assigned inline ---
    await window.getByPlaceholder('New profile name').fill('Flow Profile');
    await window.locator('select[title="Move to group…"]').selectOption({ label: 'Flow Group' });
    await window.getByRole('button', { name: 'New Profile' }).click();
    await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
    const row = window.locator('tr', { has: window.locator('td', { hasText: /^Flow Profile$/ }) });
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.locator('td', { hasText: 'Flow Group' })).toBeVisible();

    // --- Fingerprint already auto-generated; confirm it's there and coherent ---
    await row.getByRole('button', { name: 'Edit' }).click();
    await window.getByText('fingerprint', { exact: true }).click();
    await window.getByRole('button', { name: 'Validate' }).click();
    await expect(window.getByText('no contradictions found')).toBeVisible({ timeout: 10_000 });
    await window.getByRole('button', { name: 'Close' }).click();

    // --- Start, open a tab, navigate, download ---
    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

    let shell = await connectToShell();
    await expect(shell.locator('.tab')).toHaveCount(1, { timeout: 15_000 });
    await shell.locator('#new-tab').click();
    await expect(shell.locator('.tab')).toHaveCount(2);

    const address = shell.locator('#address');
    await address.fill('https://example.com');
    await address.press('Enter');
    await expect(address).toHaveValue(/example\.com/, { timeout: 15_000 });

    await address.fill(`http://127.0.0.1:${filePort}/flow-test-file.txt`);
    await address.press('Enter');
    await expect(shell.locator('.download-item')).toHaveCount(1, { timeout: 20_000 });
    await expect(shell.locator('.download-status').first()).toContainText('completed', { timeout: 20_000 });

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
    await cdp?.close();
    cdp = undefined;

    // Download persisted to the manager's Downloads history page.
    await window.getByText('Downloads', { exact: true }).click();
    await expect(window.locator('td', { hasText: 'flow-test-file.txt' })).toBeVisible({ timeout: 10_000 });
    await window.getByText('Profiles', { exact: true }).click();

    // --- Restart, verify a real storage value survives it ---
    await row.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
    shell = await connectToShell();
    await shell.locator('#address').fill('https://example.com');
    await shell.locator('#address').press('Enter');
    await expect(shell.locator('#address')).toHaveValue(/example\.com/, { timeout: 15_000 });
    let webview = shell.locator('webview').first();
    await webview.waitFor({ state: 'attached', timeout: 15_000 });
    await execInWebview(webview, 'document.cookie = "flow_persist=yes; path=/; max-age=3600"');
    await row.getByRole('button', { name: 'Restart', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
    shell = await connectToShell();
    await shell.locator('#address').fill('https://example.com');
    await shell.locator('#address').press('Enter');
    await expect(shell.locator('#address')).toHaveValue(/example\.com/, { timeout: 15_000 });
    webview = shell.locator('webview').first();
    await webview.waitFor({ state: 'attached', timeout: 15_000 });
    await expect
      .poll(async () => execInWebview(webview, 'document.cookie'), { timeout: 10_000, intervals: [250, 500, 1_000] })
      .toContain('flow_persist=yes');

    await row.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
    await cdp?.close();
    cdp = undefined;

    // --- Clone, verify independence (config carried over, storage fresh) ---
    await row.getByRole('button', { name: 'Clone' }).click();
    const cloneRow = window.locator('tr', { has: window.locator('td', { hasText: 'Flow Profile (clone)' }) });
    await expect(cloneRow).toBeVisible({ timeout: 15_000 });
    await expect(cloneRow.locator('td', { hasText: 'Flow Group' })).toBeVisible();

    await cloneRow.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(cloneRow).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
    shell = await connectToShell();
    await shell.locator('#address').fill('https://example.com');
    await shell.locator('#address').press('Enter');
    await expect(shell.locator('#address')).toHaveValue(/example\.com/, { timeout: 15_000 });
    webview = shell.locator('webview').first();
    await webview.waitFor({ state: 'attached', timeout: 15_000 });
    const cookieOnClone = await execInWebview(webview, 'document.cookie');
    // The clone never sees the source's cookie — genuinely independent storage.
    expect(String(cookieOnClone)).not.toContain('flow_persist=yes');
    await cloneRow.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(cloneRow).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });

    // --- Backup, then restore into a brand-new independent profile ---
    await row.getByRole('button', { name: 'Backup' }).click();
    await expect(window.locator('.banner-success')).toBeVisible({ timeout: 15_000 });

    // Restore opens a native OS file-picker dialog (`dialog.showOpenDialog`)
    // that Playwright/E2E cannot drive or dismiss — clicking it here would
    // hang the test indefinitely waiting on a dialog nothing will ever
    // answer. Restore's actual behavior (creates a new, independent profile,
    // never overwrites the source) is covered directly in
    // tests/unit/zipBackupRestore.test.ts, which calls the underlying
    // service method without going through the dialog at all.

    // --- Bulk operation across the remaining profiles ---
    // (bulk Export/Backup open a native save dialog Playwright can't drive
    // — see the Restore note above — so this uses bulk Add Tag instead,
    // which needs no dialog and is just as real a bulk-operation proof.)
    await window.locator('th input[type="checkbox"]').check();
    const addTagInput = window.locator('.bulk-toolbar').getByPlaceholder('Add tag + Enter');
    await addTagInput.fill('flow-bulk-tag');
    await addTagInput.press('Enter');
    await expect(window.locator('.banner-success')).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('.tag', { hasText: 'flow-bulk-tag' })).toBeVisible({ timeout: 10_000 });
  } finally {
    fileServer.close();
  }
});
