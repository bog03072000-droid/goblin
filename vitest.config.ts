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
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      electron: path.resolve(__dirname, 'tests/unit/mocks/electron.ts'),
    },
  },
});
