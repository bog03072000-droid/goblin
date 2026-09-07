import { test, expect, _electron as electron, chromium, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * Investigates a gap flagged at the start of this session but never
 * actually checked: is `navigator.plugins`/`navigator.mimeTypes` coherent
 * across different spoofed OS configurations, or does it leak this
 * project's real host machine's plugin list regardless of the configured
 * platform? Neither spoofingScript.ts nor diagnostics.html reads or
 * overrides these fields at all (confirmed by grep — zero matches), so if
 * there's a leak, nothing here would catch or mask it.
 *
 * Real CreepJS captures already taken this session (docs/creepjs-results/)
 * hinted this might already be coherent for free: a Windows-configured
 * profile showed `mimeTypes (2)`/`plugins (5)`, an Android-configured one
 * showed `mimeTypes (0)`/`plugins (0)` — real Chrome's actual behavior on
 * each real platform (desktop Chrome ships a small, OS-independent set of
 * PDF-viewer-related plugin/mimetype entries; real mobile Chrome ships
 * none). This test checks the two desktop OS values everyone would expect
 * to differ if there were a real per-OS leak: Windows and macOS.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;

const REMOTE_DEBUG_PORT = 9360;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-plugins-'));
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
  await rmSyncWithRetry(userDataDir);
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

async function readPluginsMimeTypes(
  osValue: 'windows' | 'macos',
  profileName: string,
): Promise<{ pluginNames: string[]; mimeTypeNames: string[] }> {
  await window.getByPlaceholder('New profile name').fill(profileName);
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.getByText('fingerprint', { exact: true }).click();
  await window.getByLabel('Operating system').selectOption(osValue);
  const expectedUaFragment = osValue === 'windows' ? 'Windows' : 'Macintosh';
  await expect(window.getByTestId('fp-site-preview').locator('.fp-preview-ua')).toContainText(expectedUaFragment, {
    timeout: 10_000,
  });
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: profileName }) });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const shell = await connectToShell();
  const webview = shell.locator('webview').first();
  await webview.waitFor({ state: 'attached', timeout: 15_000 });
  const evalIn = async (expr: string) =>
    webview.evaluate(
      (el, e) => (el as unknown as { executeJavaScript: (s: string) => Promise<unknown> }).executeJavaScript(e),
      expr,
    );

  const result = (await evalIn(
    'JSON.stringify({ pluginNames: Array.from(navigator.plugins).map(p => p.name), mimeTypeNames: Array.from(navigator.mimeTypes).map(m => m.type) })',
  )) as string;

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
  await cdp?.close();
  cdp = undefined;

  return JSON.parse(result) as { pluginNames: string[]; mimeTypeNames: string[] };
}

test('navigator.plugins/mimeTypes are identical between a Windows-configured and a macOS-configured profile — real Chromium behavior, not a per-OS leak', async () => {
  const windowsResult = await readPluginsMimeTypes('windows', 'E2E Plugins Windows');
  const macResult = await readPluginsMimeTypes('macos', 'E2E Plugins macOS');

  // eslint-disable-next-line no-console
  console.log('[plugins-mimetypes] windows:', JSON.stringify(windowsResult));
  // eslint-disable-next-line no-console
  console.log('[plugins-mimetypes] macos:', JSON.stringify(macResult));

  expect(windowsResult.pluginNames).toEqual(macResult.pluginNames);
  expect(windowsResult.mimeTypeNames).toEqual(macResult.mimeTypeNames);
});
