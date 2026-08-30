import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
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
