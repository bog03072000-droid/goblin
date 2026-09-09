import { test, expect, chromium, _electron as electron, type ElectronApplication, type Page, type Browser } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rmSyncWithRetry } from './helpers/rmSyncWithRetry';

/**
 * Real, end-to-end confirmation of the "Test human input" toolbar button
 * (browser-shell.html/.js) — lets a user visually confirm humanClick/
 * humanScroll work against a real loaded page without writing their own
 * automation script (see README's Automation section). Connects to the
 * profile's own browser-shell window via CDP (same pattern
 * fullUserFlow.spec.ts already uses), clicks the real button, and reads
 * back the REAL loaded page's own mousemove/wheel listener counts — proof
 * the click actually drove real input into the guest page, not just that
 * the button's own click handler ran.
 */
test.setTimeout(90_000);

const REMOTE_DEBUG_PORT = 9351;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
let cdp: Browser | undefined;

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-test-human-input-btn-'));
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

/** Same transient-failure-tolerant helper as fullUserFlow.spec.ts's own
 * (duplicated rather than shared — see this project's own convention of
 * each E2E file being self-contained). */
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

test('"Test human input" button drives a real mouse move+click+scroll into the loaded page', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Human Input Button Profile');
  await window.getByRole('button', { name: 'New Profile', exact: true }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Human Input Button Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });

  const shell = await connectToShell();
  const address = shell.locator('#address');
  // Same race found and fixed in loadTestClone.spec.ts (commit 9aee003):
  // the webview auto-navigates to google.com the instant it attaches.
  await expect(address).toHaveValue(/google\.com/, { timeout: 15_000 });
  await address.fill('https://example.com');
  await address.press('Enter');
  await expect(address).toHaveValue(/example\.com/, { timeout: 15_000 });

  const webview = shell.locator('webview').first();
  await webview.waitFor({ state: 'attached', timeout: 15_000 });

  // Real page-side listeners, set up BEFORE clicking the button — what's
  // recorded is genuinely what the loaded guest page's own DOM received.
  await execInWebview(
    webview,
    `
      document.body.style.height = '3000px';
      window.__moveEvents = 0;
      window.__wheelEvents = 0;
      document.addEventListener('mousemove', () => { window.__moveEvents++; });
      window.addEventListener('wheel', () => { window.__wheelEvents++; });
      true;
    `,
  );

  const button = shell.locator('#test-human-input');
  await expect(button).toBeVisible();
  await button.click();
  await expect(button).toHaveText(/Done|Running/, { timeout: 15_000 });
  await expect(button).toHaveText('Done — watch the page', { timeout: 15_000 });

  const moveCount = await execInWebview(webview, 'window.__moveEvents');
  const wheelCount = await execInWebview(webview, 'window.__wheelEvents');
  const scrollY = await execInWebview(webview, 'window.scrollY');

  // Real, multiple intermediate events reached the guest page — not one
  // instant jump/scroll, same "genuinely dispatched over real events, not
  // just that the button's own handler ran" standard as
  // humanInputDriver.spec.ts.
  expect(moveCount as number).toBeGreaterThan(3);
  expect(wheelCount as number).toBeGreaterThan(1);
  expect(scrollY as number).toBeGreaterThan(0);

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
