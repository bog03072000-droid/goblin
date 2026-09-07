import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { humanClick, humanType, humanScroll, type CdpSession } from '../../src/shared/automation/humanInputDriver';

/**
 * Real, end-to-end confirmation that humanClick/humanType/humanScroll
 * genuinely dispatch multiple real CDP events over real wall-clock time
 * against a live running profile — not a claim resting only on the unit
 * tests' fake CdpSession. Connects to the profile's own automation CDP
 * endpoint (the same one README documents for Puppeteer/Playwright) using
 * nothing but a plain WebSocket client and this project's own driver,
 * then reads back the REAL PAGE's own recorded mousemove/keydown/wheel
 * events — proof the browser actually received and processed real input,
 * not just that this test's outgoing CDP calls were made.
 *
 * See docs/BEHAVIORAL_EMULATION.md's Part 5 for what this can and can't
 * prove: this confirms the mechanism fires as claimed, not any real
 * effect on a specific commercial behavioral detector.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

const AUTOMATION_PORT = 19223;

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

/** Minimal real CDP client over a plain WebSocket (Node 22's built-in
 * global, no extra dependency) — attaches to the browser's one page
 * target with `flatten: true` so every command after that carries a
 * `sessionId`, matching how Puppeteer/Playwright's own CDP sessions work. */
async function connectToPageSession(webSocketDebuggerUrl: string): Promise<{ session: CdpSession; close: () => void }> {
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

  const session: CdpSession = {
    send: (method: string, params?: Record<string, unknown>) => rawSend(method, params, sessionId),
  };
  return { session, close: () => ws.close() };
}

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-human-input-'));
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

test('humanClick/humanType dispatch real, multi-event, time-spread input against a live profile', async () => {
  await window.getByPlaceholder('New profile name').fill('E2E Human Input Profile');
  await window.getByRole('button', { name: 'Custom setup' }).click();
  await window.locator('.modal-panel').getByRole('button', { name: 'Create profile' }).click();
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'E2E Human Input Profile' }) });
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

  const { session, close } = await connectToPageSession(webSocketDebuggerUrl);
  try {
    // Set up a real page-side listener BEFORE dispatching anything, so
    // what's recorded is genuinely what the browser's own DOM received —
    // not something this test asserts about its own outgoing calls.
    await session.send('Runtime.evaluate', {
      expression: `
        window.__moveEvents = [];
        document.addEventListener('mousemove', (e) => window.__moveEvents.push(Date.now()));
        true;
      `,
    });

    const clickStart = Date.now();
    await humanClick(session, { x: 50, y: 400 }, { x: 250, y: 400 }, { steps: 12, durationMs: 300 });
    const clickElapsed = Date.now() - clickStart;

    // Created and focused AFTER the click (a real click elsewhere on the
    // page would blur it otherwise) — this test's own setup, not something
    // humanClick/humanType need to worry about in real usage, where a
    // caller focuses its own target before typing into it.
    await session.send('Runtime.evaluate', {
      expression: `
        const input = document.createElement('input');
        input.id = 'human-input-target';
        input.style.cssText = 'position:fixed;top:10px;left:10px;width:300px;';
        document.body.appendChild(input);
        input.focus();
        window.__keyEvents = [];
        input.addEventListener('keydown', (e) => window.__keyEvents.push(Date.now()));
        true;
      `,
    });

    const moveCountResult = (await session.send('Runtime.evaluate', {
      expression: 'window.__moveEvents.length',
      returnByValue: true,
    })) as { result: { value: number } };
    const moveCount = moveCountResult.result.value;

    // Real, multiple intermediate events reached the page — not a single
    // instant jump. steps: 12 -> 13 mouseMoved dispatches; a handful may
    // legitimately coalesce at the DOM level, so this checks "clearly
    // more than one," not an exact count.
    expect(moveCount).toBeGreaterThan(5);
    // The whole sequence really took real wall-clock time roughly matching
    // the requested duration, not an instant burst.
    expect(clickElapsed).toBeGreaterThanOrEqual(200);

    const typeStart = Date.now();
    await humanType(session, 'hello', { meanDelayMs: 40, stdDevMs: 5, minDelayMs: 20, mistakeProbability: 0 });
    const typeElapsed = Date.now() - typeStart;

    const inputValueResult = (await session.send('Runtime.evaluate', {
      expression: "document.getElementById('human-input-target').value",
      returnByValue: true,
    })) as { result: { value: string } };
    const keyCountResult = (await session.send('Runtime.evaluate', {
      expression: 'window.__keyEvents.length',
      returnByValue: true,
    })) as { result: { value: number } };

    expect(inputValueResult.result.value).toBe('hello');
    expect(keyCountResult.result.value).toBe(5);
    // 4 real inter-keystroke delays of ~40ms each between 5 characters.
    expect(typeElapsed).toBeGreaterThanOrEqual(120);

    // A tall body so there's real room to scroll, plus a wheel listener
    // on window (where wheel events actually land for a page-level
    // scroll), set up before dispatching anything.
    await session.send('Runtime.evaluate', {
      expression: `
        document.body.style.height = '5000px';
        window.__wheelEvents = [];
        window.addEventListener('wheel', (e) => window.__wheelEvents.push({ t: Date.now(), deltaY: e.deltaY }));
        true;
      `,
    });

    const scrollStart = Date.now();
    await humanScroll(session, { x: 400, y: 300 }, 900, { steps: 9, durationMs: 250 });
    const scrollElapsed = Date.now() - scrollStart;

    const wheelResult = (await session.send('Runtime.evaluate', {
      expression: 'JSON.stringify({ count: window.__wheelEvents.length, totalDeltaY: window.__wheelEvents.reduce((s, e) => s + e.deltaY, 0), scrollY: window.scrollY })',
      returnByValue: true,
    })) as { result: { value: string } };
    const wheelStats = JSON.parse(wheelResult.result.value) as { count: number; totalDeltaY: number; scrollY: number };

    // Real, multiple intermediate wheel events reached the page — not one
    // instant jump to the final scroll position.
    expect(wheelStats.count).toBeGreaterThan(3);
    // Real Chromium wheel-event delivery introduces a few pixels of its
    // own rounding/coalescing on top of what was dispatched — this checks
    // the total landed close to the requested 900px, not bit-exact.
    expect(Math.abs(wheelStats.totalDeltaY - 900)).toBeLessThan(20);
    expect(wheelStats.scrollY).toBeGreaterThan(0);
    // The whole sequence really took real wall-clock time roughly matching
    // the requested duration, not an instant burst.
    expect(scrollElapsed).toBeGreaterThanOrEqual(150);
  } finally {
    close();
  }

  await row.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(row).toHaveAttribute('data-status', 'STOPPED', { timeout: 30_000 });
});
