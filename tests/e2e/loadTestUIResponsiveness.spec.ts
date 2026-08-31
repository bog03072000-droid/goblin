import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SEED_DIR } from '../performance/loadTestUiSeedDir';

/**
 * Real-world load test — Test 8 (UI Responsiveness) from the load-test
 * brief: with 200 profiles already stored, is the manager UI (search,
 * filter, select-all, invert selection, bulk operations, group filtering,
 * tag filtering) still responsive?
 *
 * No real browser child PROCESSES are involved here — the 200 profiles are
 * pre-seeded once via tests/performance/seedLoadTestUiDb.test.ts (see that
 * file's own comment for why seeding happens there, in vitest/Node, rather
 * than inline in this Playwright file — a better-sqlite3 native-ABI
 * conflict between "Node" and "Electron" builds of the same addon). This
 * file only copies that pre-built profileforge.db + profiles/ tree into a
 * fresh --user-data-dir and launches the real app against it — resource-safe
 * (one manager window, zero per-profile Chromium child processes), and
 * measures exactly what the brief asks: the manager UI's own responsiveness
 * against a real 200-row dataset.
 *
 * Run `npm run rebuild:node && npx vitest run --config vitest.perf.config.ts
 * tests/performance/seedLoadTestUiDb.test.ts && npm run rebuild:electron`
 * before this file if tests/performance/.load-test-ui-seed doesn't exist yet.
 */
const SCALE = 200;

let app: ElectronApplication;
let window: Page;
let userDataDir: string;
const timings: Record<string, number> = {};

test.setTimeout(120_000);

test.beforeAll(async () => {
  if (!fs.existsSync(path.join(SEED_DIR, 'profileforge.db'))) {
    throw new Error(
      `Seed DB not found at ${SEED_DIR} — run: npm run rebuild:node && npx vitest run --config vitest.perf.config.ts tests/performance/seedLoadTestUiDb.test.ts && npm run rebuild:electron`,
    );
  }
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-load-ui-'));
  fs.cpSync(SEED_DIR, userDataDir, { recursive: true });

  app = await electron.launch({
    args: [path.join(__dirname, '..', '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, PF_E2E_LOCALE: 'en' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await expect(window.locator('tbody tr')).toHaveCount(SCALE, { timeout: 30_000 });
});

test.afterAll(async () => {
  await app.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  const lines = [
    '# Load test — UI responsiveness at 200 stored profiles (raw data)',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Interaction | Time to settle (ms) |',
    '|---|---|',
    ...Object.entries(timings).map(([op, ms]) => `| ${op} | ${ms.toFixed(0)} |`),
    '',
    '_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._',
    '',
  ];
  fs.writeFileSync(path.join(__dirname, '..', 'performance', 'LOAD_TEST_UI_RESPONSIVENESS_RAW.md'), lines.join('\n'), 'utf-8');
  // eslint-disable-next-line no-console
  console.log('\n' + lines.join('\n'));
});

test('initial render of 200 stored profiles', async () => {
  // Already awaited in beforeAll — this records how long the SUBSEQUENT full
  // reload takes, proving it's not a one-time cold-start fluke.
  const t0 = performance.now();
  await window.reload();
  await window.waitForLoadState('domcontentloaded');
  await expect(window.locator('tbody tr')).toHaveCount(SCALE, { timeout: 30_000 });
  timings['reload + render 200 rows'] = performance.now() - t0;
});

test('search narrows 200 rows to a match', async () => {
  const t0 = performance.now();
  await window.getByPlaceholder('Search profiles...').fill('Load UI Profile 099');
  await expect(window.locator('tbody tr')).toHaveCount(1, { timeout: 10_000 });
  timings['search (200 -> 1 row)'] = performance.now() - t0;
  await window.getByPlaceholder('Search profiles...').fill('');
  await expect(window.locator('tbody tr')).toHaveCount(SCALE, { timeout: 10_000 });
});

test('tag filter narrows the list', async () => {
  const t0 = performance.now();
  await window.locator('select').nth(1).selectOption('even5');
  await expect(window.locator('tbody tr')).toHaveCount(40, { timeout: 10_000 }); // ceil(200/5)
  timings['tag filter (even5)'] = performance.now() - t0;
  await window.locator('select').nth(1).selectOption('');
  await expect(window.locator('tbody tr')).toHaveCount(SCALE, { timeout: 10_000 });
});

test('group filter narrows the list', async () => {
  const groupSelect = window.locator('select').nth(2);
  const groupValue = await groupSelect.locator('option', { hasText: 'Load UI Group A' }).getAttribute('value');
  const t0 = performance.now();
  await groupSelect.selectOption(groupValue!);
  await expect(window.locator('tbody tr')).toHaveCount(50, { timeout: 10_000 }); // i % 4 === 0 across 200
  timings['group filter (Load UI Group A)'] = performance.now() - t0;
  await groupSelect.selectOption('');
  await expect(window.locator('tbody tr')).toHaveCount(SCALE, { timeout: 10_000 });
});

test('select-all (header checkbox) selects all visible rows', async () => {
  const t0 = performance.now();
  await window.locator('th input[type="checkbox"]').check();
  await expect(window.getByText(`${SCALE} selected`)).toBeVisible({ timeout: 10_000 });
  timings['select-all (200 rows)'] = performance.now() - t0;
});

test('invert selection flips all 200 to unselected', async () => {
  const t0 = performance.now();
  await window.getByRole('button', { name: 'Invert selection' }).click();
  await expect(window.locator('.bulk-toolbar')).toBeHidden({ timeout: 10_000 });
  timings['invert selection (200 -> 0)'] = performance.now() - t0;
});

test('bulk add-tag across all 200 selected profiles completes and is reflected in the UI', async () => {
  await window.locator('th input[type="checkbox"]').check();
  await expect(window.getByText(`${SCALE} selected`)).toBeVisible({ timeout: 10_000 });

  const t0 = performance.now();
  const tagInput = window.locator('.bulk-toolbar').getByPlaceholder('Add tag + Enter');
  await tagInput.fill('load-ui-bulk-tag');
  await tagInput.press('Enter');
  await expect(window.locator('.banner-success')).toBeVisible({ timeout: 30_000 });
  timings['bulk add-tag (200 profiles)'] = performance.now() - t0;

  await window.locator('select').nth(1).selectOption('load-ui-bulk-tag');
  await expect(window.locator('tbody tr')).toHaveCount(SCALE, { timeout: 15_000 });
  await window.locator('select').nth(1).selectOption('');
});

test('sort toggle re-orders 200 rows', async () => {
  const t0 = performance.now();
  await window.locator('.toolbar').getByTitle(/ascending|descending/i).click();
  await expect(window.locator('tbody tr')).toHaveCount(SCALE, { timeout: 10_000 });
  timings['sort direction toggle (200 rows)'] = performance.now() - t0;
});
