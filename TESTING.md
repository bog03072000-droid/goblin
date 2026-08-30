# Testing

## Unit + integration suite (126 tests across 21 files, all passing as of this writing)

Run with `npm run rebuild:node && npm test`.

- `tests/unit/profileStorage.test.ts` — path-traversal rejection, UUID
  validation, per-profile directory isolation, create/delete.
- `tests/unit/fingerprintGenerator.test.ts` — determinism per seed, variety
  across seeds, every generated fingerprint passes its own validator, explicit
  `os` constraint honored.
- `tests/unit/spoofingScript.test.ts` — `buildFakeMediaDevices()` determinism
  and cross-seed variation; `buildSpoofingScript()` emits each conditional
  patch (canvas/audio/webgl/fonts/media-devices) only when its mode flag says
  to, emits the unconditional device-memory override always, and produces
  syntactically valid JS.
- `tests/unit/consistencyEngine.test.ts` — the fingerprint validator's
  cross-field coherence checks against the specific "impossible combination"
  examples named in the fingerprint audit brief (Windows + macOS-only
  platform, macOS + Windows-only UA), plus CPU/RAM plausibility warnings.
- `tests/unit/browserCompatibility.test.ts` — the Chromium-version-drift
  check used by `ProfileManager.start()` to flag a profile whose fingerprint
  claims a different major Chromium version than the one actually running.
- `tests/unit/lockManager.test.ts` — lock/unlock, duplicate-lock rejection,
  stale-lock (dead PID) recovery without touching profile data.
- `tests/unit/repositories.test.ts` — fingerprint/proxy/profile repository
  round-trips; proxy password never appears in `list()`/`getById()` output;
  tag filtering; deleting a profile doesn't cascade into unrelated data.
- `tests/unit/downloadRepository.test.ts` — create/list/filter (by profile,
  filename search, date range)/delete against a real SQLite file; cascade
  deletion when the owning profile is deleted.
- `tests/unit/groups.test.ts` — create/rename/delete a group, profile counts
  per group, a deleted group's profiles become ungrouped rather than orphaned.
- `tests/unit/settingsRepository.test.ts` — defaults when nothing is stored,
  partial updates persist and merge correctly, a corrupted individual setting
  key doesn't break reading the rest.
- `tests/unit/templates.test.ts` — the 6 built-in templates seed idempotently
  with coherent os/locale definitions.
- `tests/unit/exportFormat.test.ts` — export manifest schema accepts valid
  data, rejects unknown format/version/malformed fingerprints, never leaks a
  password field even if one is injected.
- `tests/unit/zipBackupRestore.test.ts` — one-click backup produces a real
  `.zip`, restore from it creates a new independent profile (never overwrites
  the source), a corrupted/incomplete archive is rejected cleanly.
- `tests/unit/importExportBulk.test.ts` — multi-file import with per-file
  error isolation (one bad manifest doesn't abort the batch), duplicate-name
  numbered-suffix handling, and `ImportExportService.bulkBackup()`'s own
  per-item success/failure isolation.
- `tests/unit/bulkOperations.test.ts` — every `ProfileManager` bulk method
  (start/stop/restart/delete/clone/assign-proxy/assign-group/add-tags/
  remove-tags) against a real (in-memory) SQLite DB: per-item failure
  isolation, and a regression test for a real bug (`bulkStop()` used to not
  `await` each `stop()` call, reporting success before the stop actually
  completed).
- `tests/unit/profileManagerErrors.test.ts` — starting an already-running
  profile, stopping an already-stopped one (graceful, not an error), a
  profile whose storage directory was deleted outside the app, an
  asynchronous spawn failure (child `'error'` event) marking the profile
  `ERROR` instead of leaving it stuck `STARTING`, and a corrupted fingerprint
  row (malformed JSON in the `languages` column) failing cleanly instead of
  crashing.
- `tests/unit/errorMessages.test.ts` / `tests/unit/i18n.test.ts` — every
  recognized backend error message maps to a translated, human-readable UI
  string in both locales; UK/EN key parity is asserted directly (not just
  eyeballed) whenever either locale file changes.
- `tests/unit/proxyTester.test.ts` — the TCP-reachability check's own
  success/timeout/refused-connection paths.
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

15 files, 43 tests, run with:

```bash
npm run build && npm run rebuild:electron && npm run test:e2e
```

This launches the actual compiled manager process (`@playwright/test`'s
`_electron` launcher) against a temp `--user-data-dir`, so it exercises the
real Electron main + preload + `contextBridge` + IPC + SQLite + React
renderer stack — not just the in-process repository code the unit/integration
suite calls directly. Files that need to drive a *second*, independent
Electron/Chromium process (an actual running profile) connect to it over CDP
using a test-only `PF_E2E_REMOTE_DEBUG_PORT` env var
(`profileWindowEntry.ts`) — never set in a normal launch.

- `profileLifecycle.spec.ts` — Profiles page CRUD/search/navigation without
  ever starting a real browser process (fast, no nested process).
- `profileBrowserLifecycle.spec.ts` — real Start/Stop, a real Restart that
  produces a genuinely new OS process (PID changes), and a persistent
  cookie/localStorage/IndexedDB value set before Restart still being present
  after it (the storage backends load their on-disk files asynchronously on
  a fresh process start, so the read is polled rather than read once).
- `fingerprintEnforcement.spec.ts` — the core fingerprint-audit verification:
  starts a profile with `PF_E2E_AUTO_DIAGNOSTICS=1`, reads the real
  observed-vs-configured snapshot. Confirms always-on fields (UA, platform,
  languages, timezone, screen, hardwareConcurrency, deviceMemory,
  canvas/audio noise) genuinely `PASS`/`APPLIED`; confirms opt-in fields
  (WebGL vendor/renderer, fonts, media devices) honestly report
  `NOT_IMPLEMENTED` while off; confirms canvas noise is deterministic for one
  profile and differs between two different profiles reading identical
  content; and separately enables `webglSpoofingMode: 'spoof'` to prove both
  that it actually overrides the observed vendor/renderer **and** that an
  unrelated real WebGL capability (`MAX_TEXTURE_SIZE`) still works normally.
- `browserTabs.spec.ts` — real multi-tab browser window (new/close/switch/
  duplicate tab, address bar navigation, back/forward/reload/home, DevTools),
  and a dedicated cross-profile cookie-isolation test (two profiles, same
  real origin, proven never to see each other's cookies).
- `profileCloning.spec.ts` — clicking Clone in the real UI copies proxy/
  group/tags and carries the fingerprint identity (User-Agent) over verbatim,
  and the clone gets genuinely independent cookie storage from its source.
- `proxyIsolation.spec.ts` — three profiles configured with proxy A / proxy B
  / no proxy, each proven (via distinct local fake-proxy servers) to route
  only through its own configuration, never another profile's.
- `concurrentStartup.spec.ts` — bulk-starting 8 profiles with
  `maxConcurrentLaunches=3` against real Chromium processes: the UI stays
  responsive mid-batch, every profile reaches a terminal status (never stuck
  `STARTING`), and bulk-stop tears every one down with no orphans left.
- `downloads.spec.ts` — a real download (local HTTP server serving
  `Content-Disposition: attachment`) is detected, saved under the profile's
  own storage, shown in the in-session downloads panel, **and** persisted to
  SQLite so it shows up (with working search/delete) in the manager's
  Downloads history page after the profile stops.
- `groupsManagement.spec.ts` — create/rename/delete a group and move a
  profile into it via the real modal (never `prompt()`/`confirm()`), filter
  by group, and bulk-assign multiple selected profiles to a group at once.
- `bulkOperations.spec.ts` — multi-select, bulk add-tag, bulk delete, through
  the real UI.
- `reliability.spec.ts` — deleting a running profile is blocked with a clear
  translated message (not silently ignored, not a crash); duplicate profile
  names don't corrupt the list; a profile assigned to an unreachable proxy
  still starts and stops cleanly; starting an already-running profile and
  stopping an already-stopped one behave correctly when driven directly
  through IPC (states the UI itself can't reach a user into); a profile
  whose storage folder was deleted outside the app shows a clear translated
  error instead of crashing.
- `applicationRestartPersistence.spec.ts` — two genuinely separate
  `electron.launch()` calls (full OS process lifetimes) against the same
  `--user-data-dir`: a profile's configuration, its assigned proxy, its
  fingerprint (re-read and compared field-for-field), its tags, and its
  on-disk storage directory all survive the manager application itself being
  fully closed and reopened — not a page reload, not mocked repositories.
- `proxyVerification.spec.ts` — a profile's browser traffic genuinely routes
  through its assigned proxy for HTTP (absolute-URI request line), HTTPS (a
  real `CONNECT` tunnel request), and SOCKS5 (a real SOCKS5 CONNECT
  handshake) — a local fake proxy server receiving the actual request is the
  proof, not a mocked network layer.
- `localization.spec.ts` — Ukrainian is the default locale on first launch;
  switching to English updates the UI immediately and survives a restart.
- `profileManagerPolish.spec.ts` — the daily-use polish surfaces: creating a
  profile with group/proxy/tags set inline, filter-by-proxy, sort-direction
  toggle, invert-selection, bulk Backup's completion summary, the right-click
  context menu (state-aware — never shows "Stop" on a stopped profile), the
  editor's unsaved-changes confirmation before discarding edits, and the
  page-level keyboard shortcuts (Ctrl+F/Ctrl+N/Ctrl+A/Delete).

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
real Chromium processes at once. The product target has always been 200
*stored* profiles with a small, configurable number running concurrently
(`concurrentStartup.spec.ts` covers the concurrent-launch mechanism itself,
at a real but moderate scale — 8 profiles, not 200).

## What this suite does *not* yet cover

Honesty over appearance: these are real gaps, not implied coverage.

- **Windows installer smoke test** via the actual NSIS installer UI
  (install → run → uninstall) — not automated. What *is* verified on every
  release build: the packaged `win-unpacked/Goblin.exe` launches directly
  and shows a window titled "Goblin" (a manual smoke test performed as part
  of the final build step, not a Playwright test).
- Repeated start/stop cycling (many iterations against one profile, watching
  for orphan processes or memory growth) is exercised manually as part of
  each hardening pass rather than as a standing automated test — see the
  "Resource management" section of the most recent hardening report for what
  was actually checked and how.
- Audio noise's *numeric* effect isn't independently re-derived by any test
  (would mean reimplementing the seeded-PRNG math in the test itself) — only
  that the override is genuinely installed (`isOverridden()`) is asserted.

## Manual smoke test performed

Beyond the automated E2E suite, the packaged application is also launched
directly (`win-unpacked/Goblin.exe`, no Playwright) after each release build,
confirming clean startup with no `NODE_MODULE_VERSION` mismatch, no
missing-file errors, and a real "Goblin"-titled window — a quick manual
sanity check run before/after the fuller E2E suite, not a replacement for it.
