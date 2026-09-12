import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * Real, end-to-end coverage of the app-level REST API's actual security
 * boundary and CRUD behavior: enabling it through the real Settings page UI,
 * then driving it with real HTTP requests from this test process (a
 * different OS-level actor than the app itself) — not a mocked/unit-level
 * check of the routing logic in isolation (see tests/unit/restApiServer.test.ts
 * for that). Distinct from automationApi.spec.ts, which covers the
 * per-profile CDP proxy, not this app-level profile-management API.
 */
test.setTimeout(60_000);

let app: ElectronApplication;
let window: Page;
let userDataDir: string;

const REST_API_PORT = 19322;

function httpRequest(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(url, { method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf-8') }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => req.destroy(new Error('request timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

test.beforeAll(async () => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-e2e-rest-api-'));
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

test('enabling the REST API from Settings exposes a real token-gated profile-CRUD HTTP API', async () => {
  await window.getByText('Settings', { exact: true }).click();

  await window.getByLabel('Enable REST API').check();
  const portInput = window.getByLabel('Port (127.0.0.1 only)');
  await expect(portInput).toBeVisible({ timeout: 10_000 });
  await portInput.fill(String(REST_API_PORT));
  await portInput.blur();

  const tokenInput = window.locator('.panel', { has: window.locator('h3', { hasText: 'REST API' }) }).locator('input[readonly]').first();
  await expect(tokenInput).not.toHaveValue('', { timeout: 10_000 });
  const token = await tokenInput.inputValue();
  expect(token.length).toBeGreaterThanOrEqual(64);

  // The server restarts on the settings save that just happened — give it a
  // moment to actually bind before hammering it with requests.
  await window.waitForTimeout(1000);

  // --- Security boundary: same standard as automationApi.spec.ts ---
  const noToken = await httpRequest('GET', `http://127.0.0.1:${REST_API_PORT}/profiles`);
  expect(noToken.status).toBe(401);

  const wrongToken = await httpRequest('GET', `http://127.0.0.1:${REST_API_PORT}/profiles?token=not-the-real-token`);
  expect(wrongToken.status).toBe(401);

  // --- Real CRUD, over real HTTP, against the real running app ---
  const created = await httpRequest('POST', `http://127.0.0.1:${REST_API_PORT}/profiles?token=${token}`, {
    name: 'REST API E2E Profile',
    fingerprint: { os: 'windows' },
  });
  expect(created.status).toBe(201);
  const createdProfile = JSON.parse(created.body) as { id: string; name: string };
  expect(createdProfile.name).toBe('REST API E2E Profile');

  // The exact same profile is visible through the app's own UI — proof this
  // hit the real ProfileManager/database, not a parallel/mocked one.
  const row = window.locator('tr', { has: window.locator('td', { hasText: 'REST API E2E Profile' }) });
  await window.getByText('Profiles', { exact: true }).click();
  await expect(row).toBeVisible({ timeout: 10_000 });

  const list = await httpRequest('GET', `http://127.0.0.1:${REST_API_PORT}/profiles?token=${token}`);
  expect(list.status).toBe(200);
  expect((JSON.parse(list.body) as Array<{ name: string }>).some((p) => p.name === 'REST API E2E Profile')).toBe(true);

  const patched = await httpRequest('PATCH', `http://127.0.0.1:${REST_API_PORT}/profiles/${createdProfile.id}?token=${token}`, {
    name: 'REST API E2E Profile (renamed)',
  });
  expect(patched.status).toBe(200);
  expect((JSON.parse(patched.body) as { name: string }).name).toBe('REST API E2E Profile (renamed)');

  // A change made via the REST API is real (the GET above and the app's own
  // UI both read the same database), but this page has no live-update
  // channel for changes it didn't itself initiate — re-navigating to
  // Profiles is what actually re-fetches the list, the same "nothing
  // pushes new state at the renderer" gap PF_E2E work elsewhere in this
  // app already documents for its own polling logic. Re-navigate here
  // rather than asserting the row updates on its own.
  await window.getByText('Settings', { exact: true }).click();
  await window.getByText('Profiles', { exact: true }).click();
  const renamedRow = window.locator('tr', { has: window.locator('td', { hasText: 'REST API E2E Profile (renamed)' }) });
  await expect(renamedRow).toBeVisible({ timeout: 10_000 });

  const started = await httpRequest('POST', `http://127.0.0.1:${REST_API_PORT}/profiles/${createdProfile.id}/start?token=${token}`);
  expect(started.status).toBe(200);
  expect((JSON.parse(started.body) as { status: string }).status).toBe('RUNNING');

  const getAfterStart = await httpRequest('GET', `http://127.0.0.1:${REST_API_PORT}/profiles/${createdProfile.id}?token=${token}`);
  expect((JSON.parse(getAfterStart.body) as { status: string }).status).toBe('RUNNING');

  const stopped = await httpRequest('POST', `http://127.0.0.1:${REST_API_PORT}/profiles/${createdProfile.id}/stop?token=${token}`);
  expect(stopped.status).toBe(200);
  expect((JSON.parse(stopped.body) as { status: string }).status).toBe('STOPPED');

  const deleted = await httpRequest('DELETE', `http://127.0.0.1:${REST_API_PORT}/profiles/${createdProfile.id}?token=${token}`);
  expect(deleted.status).toBe(204);
  // delete() is a soft-delete (see ProfileManager.delete()/the app's own
  // undo-toast feature) — GET /profiles/:id still finds the row (same as
  // ProfileRepository.getById() never filtering deleted_at), but the list
  // endpoint excludes it, same as ProfileRepository.list()'s own default.
  const listAfterDelete = await httpRequest('GET', `http://127.0.0.1:${REST_API_PORT}/profiles?token=${token}`);
  expect((JSON.parse(listAfterDelete.body) as Array<{ id: string }>).some((p) => p.id === createdProfile.id)).toBe(false);
});
