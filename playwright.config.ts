import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // The blocking `e2e` CI job runs the full suite via a bare `playwright
  // test` with no path filter, which also picks up tests/e2e/loadTest*.spec.ts
  // — those need a DB seeded by `npm run test:perf` (seedLoadTestUiDb.test.ts),
  // which only the separate, non-blocking `performance` job runs. On a dev
  // machine that seed file already exists from a prior manual test:perf run,
  // so this was invisible locally and only broke on a fresh CI checkout
  // (real failure: "Seed DB not found ... tests/performance/.load-test-ui-seed",
  // confirmed via the live e2e job's logs). PF_E2E_BLOCKING_GATE is set only
  // by the `e2e` job's step in .github/workflows/ci.yml — the `performance`
  // job (and local `npm run test:e2e`) still see every spec, including an
  // explicit loadTest*.spec.ts path passed on the CLI, which this ignore
  // would otherwise also block (Playwright applies testIgnore even to
  // explicitly-named files, confirmed empirically before choosing this fix).
  testIgnore: process.env.PF_E2E_BLOCKING_GATE ? '**/loadTest*.spec.ts' : undefined,
  timeout: 60_000,
  workers: 1,
  // One retry absorbs a known environmental flake (occasional Intl/TZ
  // initialization delay under load when spawning nested Electron processes
  // back-to-back in this sandbox — confirmed non-reproducing in isolation,
  // see TESTING.md) without masking a genuine regression, which would fail
  // both the first attempt and the retry.
  retries: 1,
  reporter: [['list']],
});
