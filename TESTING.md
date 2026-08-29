# Testing

## Unit + integration suite (55 tests, all passing as of this writing)

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
- `tests/unit/settingsRepository.test.ts` — defaults when nothing is stored,
  partial updates persist and merge correctly, a corrupted individual setting
  key doesn't break reading the rest.
- `tests/unit/templates.test.ts` — the 6 built-in templates seed idempotently
  with coherent os/locale definitions.
- `tests/unit/exportFormat.test.ts` — export manifest schema accepts valid
  data, rejects unknown format/version/malformed fingerprints, never leaks a
  password field even if one is injected.
- `tests/unit/security.test.ts` — dedicated adversarial suite; see
  SECURITY.md's "Adversarial test suite" section for exactly what it covers
  (malformed IPC payloads, path-traversal variants, malformed/polluted import
  manifests, DB-level corruption resistance).
- `tests/integration/profileIsolation.test.ts` — `ProfileManager` end-to-end
  against a real (in-memory) SQLite DB and a real temp-directory filesystem:
  each created profile gets its own directory, one profile's files are
  invisible to another, full-clone copies storage while config-clone doesn't,
  deleting one profile leaves others' storage intact.

## E2E suite (Playwright driving the real Electron app)

Two files, 7 tests total, run with:

```bash
npm run build && npm run rebuild:electron && npm run test:e2e
```

This launches the actual compiled manager process (`@playwright/test`'s
`_electron` launcher) against a temp `--user-data-dir`, so it exercises the
real Electron main + preload + `contextBridge` + IPC + SQLite + React
renderer stack — not just the in-process repository code the unit/integration
suite calls directly.

- `tests/e2e/profileLifecycle.spec.ts` (6 tests) — Profiles page loading
  empty, creating a profile through the UI, search filtering, deletion,
  opening the profile editor (view fingerprint fields, run validation, rename
  and save), and navigation to Proxies/Settings.
- `tests/e2e/profileBrowserLifecycle.spec.ts` (1 test, isolated because it's
  slower/more environment-sensitive) — clicks a profile's real **Start**
  button, waits for status to reach `RUNNING`, confirms the per-profile
  `browser-data` directory actually gets created on disk (proof the nested
  Electron/Chromium process really launched with its own `userData` dir, not
  a simulation), then clicks **Stop** and waits for `STOPPED`.

Writing this second test surfaced a real bug during development: the
Profiles page had no polling, so after clicking Stop the row could visibly
freeze on `STOPPING` forever even though the DB/process had already finished
transitioning to `STOPPED` — nothing told the renderer to re-fetch. Fixed
with a 1s interval poll in `ProfilesPage.tsx` that runs only while at least
one visible profile is `STARTING`/`STOPPING`, and stops itself otherwise.
This is exactly the kind of bug an E2E test catches that a unit test testing
`ProfileManager` in isolation cannot, since the bug was entirely in the
renderer's refresh logic.

## Performance suite (200 profiles)

```bash
npm run test:perf
```

`tests/performance/profileScale.test.ts` creates 200 real profiles (each with
its own generated fingerprint) through the actual `ProfileManager` and
`ProfileRepository` code — not a synthetic stand-in — and times create,
list-all, name search, tag filter, config-clone, and delete. Results are
printed and written to `tests/performance/PERFORMANCE_REPORT.md` on every run
(regenerated, not hand-edited) so the numbers there are always from the most
recent actual run on this machine, never invented. Assertions use generous
sanity bounds (roughly 10x what was observed) so the test catches a real
regression without being flaky across different hardware.

This measures the DB/filesystem layer specifically — it does not launch 200
real Chromium processes, since the brief is explicit that stored profiles
don't need to run simultaneously; that would be a different (and much
heavier) benchmark than what Stage 18 is asking for.

## What this suite does *not* yet cover

Honesty over appearance: these are real gaps, not implied coverage.

- `ProfileManager.restart()` is unit-tested but not yet driven through the
  E2E UI the way start/stop now are.
- An automated "close the app, reopen it, profile data is still there"
  round-trip — persistence-across-restart is true by construction (each
  profile has its own `userData` dir independent of the manager process) but
  isn't yet asserted by a test that actually closes and reopens the app.
- Backup/Restore have storage-layer functions (`backupProfile`/
  `restoreProfile` in `profileStorage.ts`) but no IPC channel or UI wiring
  yet, so there's nothing to E2E-test there.
- **Windows installer smoke test** via the actual NSIS installer UI
  (install → run → uninstall) — not automated; see PLAN.md Stage 20 for what
  *was* verified (packaged exe launch, resource bundling, DB location).

## Manual smoke test performed

Beyond the automated E2E suite, the packaged main process was also launched
directly with `npx electron .` (no Playwright) after each major change to
`main.ts`/`profileWindowEntry.ts`, confirming clean startup with no
`NODE_MODULE_VERSION` mismatch and no missing-file errors — a quick manual
sanity check to run before reaching for the fuller E2E suite.
