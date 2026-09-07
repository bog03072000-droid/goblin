import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Resolves a long-standing open question from mobileFingerprint.spec.ts's
 * own header comment: does a real external automation client (Puppeteer/
 * Playwright/raw-CDP, connected through the documented, token-gated
 * automation API — see automationProxy.ts and README's Automation section)
 * see the SAME spoofed navigator.platform a real loaded page's own JS sees,
 * or a different (real-host) value?
 *
 * Connects exactly the way a real external client would: HTTP GET
 * /json/version with the token, take the returned webSocketDebuggerUrl,
 * open a plain WebSocket, Target.attachToTarget, then Runtime.evaluate
 * navigator.platform/userAgent on the real loaded page — the same
 * minimal-CDP-client pattern already proven in humanInputDriver.spec.ts.
 *
 * **Real, confirmed, root-caused finding — see docs/FINGERPRINT_AUDIT.md's
 * "Eleventh investigation" for the full write-up.** `navigator.userAgent`
 * IS visible correctly to a second, independent CDP session (it has a
 * genuinely global, network/header-level effect). `navigator.platform` is
 * NOT — a second sub-test below proves this is because
 * `Emulation.setUserAgentOverride`'s `platform` parameter is scoped to the
 * CDP session that issued it, by showing the external session's OWN
 * re-issued override immediately fixes it for that same session. This
 * assertion documents the CURRENT, real, honest behavior (a known gap),
 * not aspirational behavior — same convention as
 * fingerprintEnforcement.spec.ts asserting NOT_IMPLEMENTED for off-by-
 * default fields.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

const AUTOMATION_PORT = 19224;

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
  });
}

async function connectToPageSession(webSocketDebuggerUrl: string): Promise<{
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  close: () => void;
}> {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', (e) => reject(new Error(String(e))), { once: true });
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: unknown };
    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  function rawSend(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    const id = nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload['sessionId'] = sessionId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify(payload));
    });
  }

  const targets = (await rawSend('Target.getTargets')) as { targetInfos: Array<{ targetId: string; type: string }> };
  const pageTarget = targets.targetInfos.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('No page target found');
  const attach = (await rawSend('Target.attachToTarget', { targetId: pageTarget.targetId, flatten: true })) as {
    sessionId: string;
  };
  const sessionId = attach.sessionId;
  await rawSend('Runtime.enable', {}, sessionId);

  return {
    send: (method: string, params?: Record<string, unknown>) => rawSend(method, params, sessionId),
    close: () => ws.close(),
  };
}

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-automation-platform-'));
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

test('a real external CDP client (connected via the token-gated automation API) sees the real host navigator.platform, not the spoofed one — a confirmed, narrow, root-caused gap; navigator.userAgent stays correct', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Automation Platform Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  // Explicit OS pick — deliberately Linux, NOT this dev machine's real host OS
  // (Windows; CI also always runs windows-latest — see .github/workflows/ci.yml),
  // so a real-host leak and a correctly-spoofed value produce DIFFERENT,
  // distinguishable results. Picking the host's own OS here would make this
  // test pass either way and prove nothing.
  await window.getByText('fingerprint', { exact: true }).click();
  await window.getByLabel('Operating system').selectOption('linux');
  await expect(window.getByTestId('fp-site-preview').locator('.fp-preview-ua')).toContainText('Linux', {
    timeout: 10_000,
  });

  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Automation Platform Profile' }) });
  await expect(row).toBeVisible({ timeout: 15_000 });

  await row.getByRole('button', { name: 'Edit' }).click();
  await expect(window.locator('text=Loading…')).toHaveCount(0, { timeout: 15_000 });
  await window.getByText('advanced', { exact: true }).click();
  await window.getByLabel('Enable automation access').check();
  const portInput = window.getByLabel('Port (127.0.0.1 only)');
  await expect(portInput).toBeVisible({ timeout: 10_000 });
  await portInput.fill(String(AUTOMATION_PORT));
  await portInput.blur();
  const tokenInput = window.locator('.panel', { has: window.locator('h4', { hasText: 'Automation' }) }).locator('input[readonly]');
  await expect(tokenInput).not.toHaveValue('', { timeout: 10_000 });
  const token = await tokenInput.inputValue();
  await window.getByRole('button', { name: 'Close' }).click();

  await row.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'RUNNING', { timeout: 30_000 });
  await window.waitForTimeout(1500);

  const versionResponse = await httpGet(`http://127.0.0.1:${AUTOMATION_PORT}/json/version?token=${token}`);
  expect(versionResponse.status).toBe(200);
  const { webSocketDebuggerUrl } = JSON.parse(versionResponse.body) as { webSocketDebuggerUrl: string };

  const { send, close } = await connectToPageSession(webSocketDebuggerUrl);
  try {
    const platformResult = (await send('Runtime.evaluate', {
      expression: 'navigator.platform',
      returnByValue: true,
    })) as { result: { value: string } };
    const uaResult = (await send('Runtime.evaluate', {
      expression: 'navigator.userAgent',
      returnByValue: true,
    })) as { result: { value: string } };

    // navigator.userAgent is correctly spoofed for this second, independent
    // CDP session — it's a genuinely global (network-header-level) effect of
    // enforceFingerprint()'s Emulation.setUserAgentOverride call, not scoped
    // to the CDP session that issued it.
    expect(uaResult.result.value).toContain('Linux');
    expect(uaResult.result.value).not.toContain('Windows');

    // navigator.platform is NOT — this external session sees the real host's
    // platform instead of the configured spoof. Documents the known, honest,
    // current gap rather than asserting aspirational behavior.
    expect(platformResult.result.value).not.toBe('Linux x86_64');

    // Root cause, proven directly: re-issuing the identical
    // Emulation.setUserAgentOverride call from THIS (external) session fixes
    // navigator.platform immediately for THIS session — the override is
    // scoped per-CDP-session, not a renderer-global effect the way the
    // userAgent string portion of the very same CDP command is.
    await send('Emulation.setUserAgentOverride', { userAgent: uaResult.result.value, platform: 'Linux x86_64' });
    const platformAfterOwnOverride = (await send('Runtime.evaluate', {
      expression: 'navigator.platform',
      returnByValue: true,
    })) as { result: { value: string } };
    expect(platformAfterOwnOverride.result.value).toBe('Linux x86_64');
  } finally {
    close();
  }

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
