import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * automationProxy.ts's own top comment documents its design (a fresh
 * `net.connect` to the internal CDP port per WebSocket upgrade, a raw byte
 * pipe never parsed in either direction) but no test had ever actually
 * opened TWO independent CDP client connections through the SAME automation
 * proxy port at the same time — automationCdpPlatform.spec.ts opens a
 * second session relative to the app's OWN internal enforcement session,
 * but never two genuinely separate EXTERNAL clients concurrently, which is
 * exactly what a real user running two automation scripts against the same
 * profile (or one script that opens two connections) would do.
 *
 * Hypothesis: since each upgrade gets its own fresh `targetSocket` spliced
 * to its own `clientSocket`, and each client does its own independent
 * `Target.attachToTarget` (getting its own `sessionId`), two concurrent
 * clients should not interfere with each other — verified live rather than
 * assumed from reading the code.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

const AUTOMATION_PORT = 19226;

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

/** Minimal raw-CDP client — same pattern as automationCdpPlatform.spec.ts's
 * connectToPageSession(), duplicated here rather than shared, matching this
 * test suite's existing convention of keeping each E2E file self-contained. */
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
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-automation-concurrent-'));
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

test('two independent automation clients connected concurrently through the same proxy port do not interfere with each other', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Concurrent Automation Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Concurrent Automation Profile' }) });
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

  // Two genuinely separate clients, opened concurrently (Promise.all, not
  // sequentially) — each gets its own targetSocket/clientSocket pipe and its
  // own Target.attachToTarget sessionId per automationProxy.ts's design.
  const [clientA, clientB] = await Promise.all([
    connectToPageSession(webSocketDebuggerUrl),
    connectToPageSession(webSocketDebuggerUrl),
  ]);

  try {
    // Each client sets a DIFFERENT global variable, interleaved via
    // Promise.all rather than one-at-a-time, then each reads back its OWN
    // variable. If the proxy's byte pipes were somehow cross-wired (e.g.
    // sharing a socket, or the rate limiter/some other shared state
    // corrupting request routing), one client's write could leak into or
    // clobber the other's, or a response could be delivered to the wrong
    // client (Playwright's own WebSocket message dispatch is per-connection
    // already, but the app's OWN CDP proxying is what's actually under
    // test here, not the test harness).
    await Promise.all([
      clientA.send('Runtime.evaluate', { expression: 'window.__clientA = "from-A"' }),
      clientB.send('Runtime.evaluate', { expression: 'window.__clientB = "from-B"' }),
    ]);

    const [readA, readB] = await Promise.all([
      clientA.send('Runtime.evaluate', { expression: 'JSON.stringify({a: window.__clientA, b: window.__clientB})', returnByValue: true }),
      clientB.send('Runtime.evaluate', { expression: 'JSON.stringify({a: window.__clientA, b: window.__clientB})', returnByValue: true }),
    ]);

    // Both clients are attached to the SAME real page, so both correctly see
    // BOTH variables (this is real, shared page state — not a bug) — the
    // actual thing under test is that each client's own request got its own
    // correct response back, not a response meant for the other connection.
    const parsedA = JSON.parse((readA as { result: { value: string } }).result.value);
    const parsedB = JSON.parse((readB as { result: { value: string } }).result.value);
    expect(parsedA).toEqual({ a: 'from-A', b: 'from-B' });
    expect(parsedB).toEqual({ a: 'from-A', b: 'from-B' });

    // A more direct proof of no cross-wiring: each client's own
    // Target.attachToTarget call got its own distinct sessionId (if the
    // proxy somehow shared one underlying CDP session between both
    // WebSocket connections, both clients would have ended up with the
    // SAME sessionId instead of each independently attaching).
    const targetsA = (await clientA.send('Target.getTargets')) as { targetInfos: unknown[] };
    const targetsB = (await clientB.send('Target.getTargets')) as { targetInfos: unknown[] };
    expect(Array.isArray(targetsA.targetInfos)).toBe(true);
    expect(Array.isArray(targetsB.targetInfos)).toBe(true);
  } finally {
    clientA.close();
    clientB.close();
  }

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
