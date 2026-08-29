# Testing

## Current suite (55 tests, all passing as of this writing)

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
- `tests/unit/settingsRepository.test.ts` — defaults when nothing is stored,
  partial updates persist and merge correctly, a corrupted individual setting
  key doesn't break reading the rest.
- `tests/unit/security.test.ts` — dedicated adversarial suite; see
  SECURITY.md's "Adversarial test suite" section for exactly what it covers
  (malformed IPC payloads, path-traversal variants, malformed/polluted import
  manifests, DB-level corruption resistance).

## E2E suite (Playwright driving the real Electron app)

`tests/e2e/profileLifecycle.spec.ts` — 5 tests, run with:

```bash
npm run build && npm run rebuild:electron && npm run test:e2e
```

This launches the actual compiled manager process (`@playwright/test`'s
`_electron` launcher) against a temp `--user-data-dir`, so it exercises the
real Electron main + preload + `contextBridge` + IPC + SQLite + React
renderer stack — not just the in-process repository code the unit/integration
suite calls directly. Covers: the Profiles page loading with an empty list,
creating a profile end-to-end through the UI, search filtering, deletion, and
navigation to the Proxies/Settings pages.

**Deliberately out of scope for this harness:** clicking a profile's "Start"
button, which spawns a *second*, independent Electron/Chromium OS process
per `ARCHITECTURE.md`. Reliably driving a nested Electron launch (and then
attaching to *its* window to verify storage persistence) from inside this
harness needs more sandbox/process-management work than was worth doing
speculatively — it's tracked as a follow-up in PLAN.md rather than faked with
a test that doesn't actually exercise the real launch path.

## What this suite does *not* yet cover

Honesty over appearance: these are real gaps, not implied coverage.

- **Full browser-process lifecycle** (start → real Chromium window → write
  storage → stop → restart → verify persistence) — see the E2E scope note
  above. This remains the single biggest gap versus the acceptance criteria
  in the project brief.
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
- **Adversarial IPC/security suite** beyond what Zod's schema rejection and
  the path-traversal tests already cover — see SECURITY.md's "known gaps".
- **Windows installer smoke test** (install → run → uninstall, verify profile
  data survives/doesn't per user choice) — not run yet.

## Manual smoke test performed

Beyond the automated E2E suite, the packaged main process was also launched
directly with `npx electron .` (no Playwright) after each major change to
`main.ts`/`profileWindowEntry.ts`, confirming clean startup with no
`NODE_MODULE_VERSION` mismatch and no missing-file errors — a quick manual
sanity check to run before reaching for the fuller E2E suite.
