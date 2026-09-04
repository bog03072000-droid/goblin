import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  // Scoped to .tsx only — applying it unfiltered broke a large fraction of
  // the plain .ts suite (found via a real full-suite run: 97 failures, all
  // in files that never import React at all), almost certainly the plugin
  // touching module resolution/transform for files it has no business
  // processing. .tsx component tests set their own
  // `// @vitest-environment jsdom` docblock to opt into a DOM per-file; the
  // many more numerous main-process .ts tests stay on the default 'node'
  // environment below and are now provably unaffected by this plugin.
  plugins: [react({ include: /\.tsx$/ })],
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      // Renderer components/pages tested primarily through real user-facing
      // behavior (see the many *.test.tsx RTL suites) rather than unit-level
      // line coverage, and E2E specs (tests/e2e/**) aren't measured here at
      // all — this vitest run only ever sees the unit/integration suite, so
      // the coverage number itself is already a floor on the UNIT layer,
      // not a claim about total test coverage across the whole test pyramid.
      exclude: [
        'src/**/*.d.ts',
        'src/renderer/main.tsx',
        'src/main/main.ts', // Electron app bootstrap — exercised by E2E, not unit tests.
      ],
      // Requested at 70% statements. Real measured baseline the day this was
      // added was 54.45% — set here anyway, deliberately, on explicit
      // instruction to accept a red CI gate rather than quietly picking a
      // number the current suite already clears. This is a real, currently
      // FAILING gate, not a decorative target — closing that gap is its own
      // dedicated follow-up (dozens of renderer files sit at 0%: ProfilesPage.tsx,
      // DownloadsPage.tsx, LogsPage.tsx, registerIpc.ts, GroupsModal.tsx,
      // ProfileCreateModal.tsx among them), not something this change itself
      // attempts. branches/functions/lines are left unset (only statements
      // was asked for) rather than guessing thresholds for axes nobody
      // specified a number for.
      thresholds: {
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      electron: path.resolve(__dirname, 'tests/unit/mocks/electron.ts'),
    },
  },
});
