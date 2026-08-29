# Testing

## Current suite (25 tests, all passing as of this writing)

Run with `npm run rebuild:node && npm test`.

- `tests/unit/profileStorage.test.ts` — path-traversal rejection, UUID
  validation, per-profile directory isolation, create/delete.
- `tests/unit/fingerprintGenerator.test.ts` — determinism per seed, variety
  across seeds, every generated fingerprint passes its own validator, explicit
  `os` constraint honored.
- `tests/unit/lockManager.test.ts` — lock/unlock, duplicate-lock rejection,
  stale-lock (dead PID) recovery without touching profile data.
- `tests/unit/repositories.test.ts` — fingerprint/proxy/profile repository
  round-trips; proxy password never appears in `list()`/`getById()` output;
  tag filtering; deleting a profile doesn't cascade into unrelated data.
- `tests/integration/profileIsolation.test.ts` — `ProfileManager` end-to-end
  against a real (in-memory) SQLite DB and a real temp-directory filesystem:
  each created profile gets its own directory, one profile's files are
  invisible to another, full-clone copies storage while config-clone doesn't,
  deleting one profile leaves others' storage intact.

## What this suite does *not* yet cover

Honesty over appearance: these are real gaps, not implied coverage.

- **Full browser-process lifecycle** (start → real Chromium window → write
  storage → stop → restart → verify persistence) requires driving an actual
  Electron/Chromium instance, which is out of scope for Vitest under plain
  Node. This needs a Playwright + Electron E2E harness (Stage 19 in PLAN.md),
  not yet built.
- **200-profile performance benchmarking** (Stage 18) — not run yet. When it
  is, real measured numbers go here and in PLAN.md; this project's own rules
  forbid inventing benchmark figures.
- **Adversarial IPC/security suite** beyond what Zod's schema rejection and
  the path-traversal tests already cover — see SECURITY.md's "known gaps".
- **Windows installer smoke test** (install → run → uninstall, verify profile
  data survives/doesn't per user choice) — not run yet.

## Manual smoke test performed

The packaged main process (compiled via `npm run build:electron` +
`npm run build:renderer`) was launched directly with `npx electron .` after
`npm run rebuild:electron`, confirming: `better-sqlite3` loads under
Electron's Node ABI, migrations apply without error, and the renderer's
`index.html` resolves and loads. This was a manual check, not an automated
one — automating it is exactly what the Playwright/Electron E2E harness above
is for.
