import path from 'node:path';

/** Shared by seedLoadTestUiDb.test.ts (vitest, writes it) and
 * tests/e2e/loadTestUIResponsiveness.spec.ts (Playwright, reads it) — kept
 * in its own plain module so the Playwright process never imports the
 * vitest test file itself (whose top-level `describe`/`it` calls are only
 * defined as globals under vitest, not under Playwright's test runner). */
export const SEED_DIR = path.join(__dirname, '.load-test-ui-seed');
