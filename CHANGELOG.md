# Changelog

## Unreleased — proxy rotation pool per group

- Groups can now carry a proxy rotation pool (migration 007:
  `group_proxy_pool`, plus a `proxy_rotation_cursor` column on `groups`).
  `ProfileManager.start()` picks the next proxy in a group's pool,
  round-robin, for any profile in that group with no proxy of its own -
  picked fresh on every start, never persisted onto the profile, so
  restarting genuinely rotates. A profile's own direct proxy assignment
  always wins over the pool, unconditionally. Managed from the "Proxy
  pool" button on each group row in the Manage Groups modal.
  `GroupRepository`/`ProfileManager` now take an optional `groups`
  dependency - existing callers/tests that omit it keep working exactly
  as before (grouped, proxy-less profiles just run unproxied).

## Unreleased — GoblinAnty rebrand, experimental macOS packaging

- Application renamed from **Goblin** to **GoblinAnty** throughout the UI
  (window titles, sidebar brand, file-dialog filter names), `package.json`
  (`productName`, `author`, `nsis.shortcutName`), and documentation. The
  npm `name` field (`profileforge`) and `build.appId`
  (`com.profileforge.app`) are deliberately left unchanged, same as the
  ProfileForge → Goblin rebrand before it — these are internal technical
  identifiers, not user-facing branding, and churning them on every
  cosmetic rename risks breaking installed-app update matching for no
  benefit. `build.publish.repo` (`goblin`) is also left unchanged — tied to
  the actual GitHub repository name, out of scope for a local rename.
  Icon assets themselves are untouched, only the text name changed.
- Added `build.mac` to `package.json` (zip target, unsigned) alongside the
  existing `build.win`. Actually ran `npm run package:mac` on this Windows
  machine to verify it — it fails immediately with "Build for macOS is
  supported only on macOS": electron-builder refuses macOS packaging from
  any non-macOS host categorically, regardless of target format. The
  config exists and is valid for whoever has real macOS hardware or a
  macOS CI runner to actually build and test with; nothing has been
  produced or verified beyond that here. See README's "Build a macOS
  package" section.

## Unreleased — audit remediation: fingerprint default, proxy edit, logs, design, CSP, refactor

- WebGL vendor/renderer spoofing now defaults to on for new profiles (was
  the single largest practical detection gap).
- Fixed `loadTestBulkStartStop.spec.ts` flakiness (two real test bugs, not
  memory pressure as previously assumed) and raised it to 10 profiles with
  real RAM data.
- Added proxy editing (`EditProxyModal.tsx`) — no more delete-and-recreate.
- Logs page: search, event-type/profile filters, cursor pagination,
  opt-in live-tail.
- Design: filled in missing icons across Proxies/Settings/Downloads/
  ConfirmDialog; self-hosted Poppins/Inter/Space Mono instead of Google Fonts.
- Removed `unsafe-inline` from `style-src` in both CSPs.
- Split `ProfilesPage.tsx` and `profileWindowEntry.ts` into focused
  modules/hooks (each now under 400 lines).

## Unreleased — final technical hardening: WebGL enabled-mode E2E, fonts re-investigation, documentation refresh

- Added the missing enabled-mode E2E test for WebGL vendor/renderer
  spoofing: turns `webglSpoofingMode` on via the real UI, starts a profile,
  and confirms both that the observed vendor/renderer genuinely match the
  configured spoofed values, and that an unrelated real WebGL capability
  (`MAX_TEXTURE_SIZE`) still returns a plausible value — proving the
  `getParameter()` override doesn't break WebGL compatibility. (A comment
  referencing this test existed since the fingerprint-spoofing stage; the
  test itself had never actually been written.)
- Re-investigated the Fonts CSS-measurement gap specifically to see whether
  it could be closed without a Chromium patch or a fragile hack. Confirmed
  it cannot — see `docs/FINGERPRINT_AUDIT.md`'s expanded Fonts section for
  the structural reason (blocking the relevant layout-measurement APIs
  would corrupt real page layout on most sites). Kept the existing
  Local-Font-Access/`document.fonts.check()`-only coverage as-is, documented
  more precisely rather than silently implied as broader.
- Full documentation refresh: README/ARCHITECTURE/SECURITY/TESTING were
  found to be ~9 commits stale (still describing the pre-rebrand,
  pre-downloads/groups/bulk-ops state) — updated to accurately reflect the
  current implementation, including the Goblin rebrand (was still
  "ProfileForge" throughout), the `groups`/`downloads` subsystems and their
  migrations, the CDP-injected spoofing-script mechanism, the graceful-quit
  `'ipc'` stdio channel (now also documented from a security-review
  standpoint), and corrected test counts (126 unit/integration across 21
  files, 43 E2E across 15 files — both roughly double what was documented).
- Added a final summary table to `docs/FINGERPRINT_AUDIT.md`
  (Feature | Supported | Actually Applied | E2E Verified | Notes) covering
  every currently-supported fingerprint field in one place.

## Unreleased — reliability: cookie/storage-restart fix, clone/proxy/concurrency E2E gaps

- Root-caused and fixed the cookie/localStorage/IndexedDB-not-surviving-
  restart bug from the prior stage's fixme'd test. The graceful `app.quit()`
  shutdown path (added previously) was already correct — verified directly
  via a throwaway diagnostic script instrumenting the IPC handler. The real
  bug was on the read side: a freshly-restarted process's storage backends
  load their on-disk files into memory asynchronously, and the address bar
  updating (on navigation commit) doesn't guarantee that load finished, so
  an immediate read could race ahead of genuinely-persisted data. Fixed by
  polling the read instead of reading once. Extended the test to cover all
  three storage types, not just cookies.
- New E2E coverage: `profileCloning.spec.ts` (clicking Clone in the real UI
  copies proxy/group/tags, carries the fingerprint identity over verbatim,
  gets independent storage), `proxyIsolation.spec.ts` (three profiles with
  three different proxy configurations, each proven to use only its own),
  `concurrentStartup.spec.ts` (bulk-starting 8 profiles against real
  Chromium processes with `maxConcurrentLaunches` respected, UI stays
  responsive, no orphan processes after bulk-stop).
- Verified (no changes needed): Electron security hardening
  (contextIsolation/nodeIntegration/sandbox, webview preload force-set,
  path traversal protection, proxy credential encryption, Zod IPC
  validation across all channels) and fingerprint consistency (existing
  E2E suite, no regressions).

## Unreleased — profile manager daily-use polish

- Filter by proxy (including "no proxy"), sort direction toggle, invert
  selection, debounced search (250ms) alongside the existing group/tag/
  status filters and select-all/clear.
- New bulk actions: Restart, Backup, Remove tag (previously only Start/
  Stop/Clone/Delete/Export/assign-proxy/assign-group/Add-tag existed).
  Fixed a real bug found while adding these: `bulkStop()` called an
  unawaited promise, reporting every stop as "succeeded" the instant it was
  *requested*, not when it actually finished. The shared `bulkRun()` is now
  genuinely async and yields to the event loop periodically so a large
  batch never blocks the main process for one long stretch.
- Per-item bulk failure detail (which profile, why) is now shown instead of
  being computed by the backend and silently discarded to an aggregate
  count.
- Profile creation: the toolbar's create-profile row now also accepts an
  optional group/proxy/tags inline — no separate edit step for the common
  case.
- Profile editor: a Reset button (reverts unsaved General/Proxy edits) and
  an unsaved-changes confirmation before closing with edits pending.
- New: a real right-click context menu on profile rows (state-aware) and
  page-level keyboard shortcuts (Ctrl+N/Ctrl+F/Ctrl+A/Delete/Enter),
  documented in a new Settings → Keyboard Shortcuts panel.

## Unreleased — daily-use reliability hardening

- New translated (UK/EN) error messages for a missing profile storage
  directory, corrupted fingerprint data, and a failed browser process
  launch — previously these fell through to a generic "something went
  wrong" message.
- `ProfileManager.start()` now checks the profile's storage directory
  actually exists before launching (previously Chromium would silently
  recreate an empty one — a silent data-loss path) and now also handles
  the child process's asynchronous `'error'` event (real spawn failures,
  e.g. a missing binary, mostly fail this way — previously only a
  synchronous throw from `spawn()` was handled, which real failures rarely
  are).
- `stop()` now asks the child process to shut down gracefully (`app.quit()`
  over a new `'ipc'` stdio channel) before falling back to a hard kill after
  3 seconds — Chromium gets a real chance to flush its cookie/localStorage
  stores instead of being cut off mid-flight.
- New E2E coverage for scenarios the UI itself can't normally reach a user
  into: starting an already-running profile, stopping an already-stopped
  one, and the missing-storage-directory case, all driven through real IPC/
  UI interaction.

## Unreleased — persistent downloads history

- New `downloads` SQLite table, written to directly by each per-profile
  child process's own `will-download` handler on every terminal download
  outcome (completed/cancelled/failed) — the manager process reads the same
  file (safe under SQLite's WAL mode).
- New Downloads page in the manager UI: search by filename, filter by
  profile/date range, Open/Show-in-folder/Delete/Re-download actions, and
  honest "Missing" detection (checks the file still exists on disk at list
  time, never a stale stored flag).
- In-session downloads panel gains live speed (MB/s) and ETA, computed
  client-side from consecutive progress samples.
- Re-download launches the profile navigating straight at the original URL
  (there's no back-channel into an already-running profile's separate OS
  process to redirect it, so this only works when the profile isn't
  currently running — documented as a known limitation, not silently
  broken).

## Unreleased — fingerprint spoofing: Canvas, Audio, Device Memory, WebGL, Fonts, Media Devices

- Closed the D-graded gaps from the fingerprint audit by injecting a seeded
  spoofing script into the page's real main JS world via CDP
  `Page.addScriptToEvaluateOnNewDocument` — necessary because
  `contextIsolation` blocks a preload script from ever reaching the page's
  own canvas/audio/WebGL prototypes.
- Canvas/audio noise: deterministic per profile (seeded off the profile's
  own seed XOR the actual content being read), on by default. Device
  memory: unconditional override, upgraded from "not implemented" to
  genuinely enforced.
- WebGL vendor/renderer spoofing shipped as a **new, off-by-default opt-in
  toggle** (`webglSpoofingMode`) rather than enabled automatically, since a
  `getParameter()` override carries real compatibility risk for sites that
  branch rendering logic on the reported GPU (some games, map renderers,
  CAPTCHAs).
- Fonts/media-devices spoofing made opt-in via their existing mode fields;
  the fonts partial-coverage limitation (blocks Local Font Access API and
  `document.fonts.check()`, not CSS-measurement detection) documented
  explicitly rather than implied as complete.
- `diagnostics.html` extended with genuine behavioral verification
  (`isOverridden()`, `canvasIsDeterministic()`, `mediaDevicesLookFake()`) so
  no field can report a false PASS/APPLIED based on configuration alone.

## Unreleased — Goblin rebrand: real tabs, downloads panel, proxy verification, groups UI

- Application renamed from ProfileForge to **Goblin** throughout the UI,
  installer (`productName`/`shortcutName`), and branding assets — a new
  design system (dark/black interface, lime-green accent) rolled out across
  every page.
- Real multi-tab browser shell per profile (previously single-tab): New/
  Close/Duplicate/Switch tab, all sharing the profile's one session
  partition.
- A minimal in-session downloads panel (list, progress, Open/Show-in-
  folder/Cancel) — later replaced by the full persistent Downloads history
  page (see above).
- Real proxy verification (not just a stored DB row) and a Groups UI
  (create/rename/delete via a real modal, filter, profile-count display).
- `src/renderer/components/ProfilesPage.tsx`/`ProfileEditorModal.tsx` split
  into smaller page/component modules with a shared `useAsyncAction` hook,
  as the single-file versions had grown large enough to be hard to navigate.

## Unreleased — multi-tab browser, restart/persistence/proxy verification

- Multi-tab browser: New Tab, Close Tab (last tab protected), Switch Tab,
  Duplicate Tab, all sharing the profile's one session/partition (tabs never
  get separate cookie jars within a profile). Verified directly against the
  real renderer logic (`did-attach-webview`/tab DOM state), not assumed.
- Two real bugs found and fixed while adding E2E coverage (not merely
  "found gaps" — actually fixed and verified):
  1. `ProfileManager.restart()` called `stop()` then immediately `start()`
     without waiting for the killed process to actually exit, racing the
     new launch against the old process's own cleanup (lock release, status
     update). Fixed: `stop()` now awaits the child's real `exit` event.
  2. The per-profile child process's `session.setProxy()` call wasn't
     awaited before the first navigation could fire, so the very first page
     load after Start could go out unproxied. Fixed: awaited before the
     window/webview are created.
- New E2E coverage: a real restart test (start → verify new PID after
  restart → verify storage/marker file persists), a real application-restart
  persistence test (two genuine separate `electron.launch()` calls against
  the same `--user-data-dir`, not a page reload or mocked repositories), and
  a real proxy-verification test using a local deterministic HTTP proxy
  harness (a plain Node server receiving the browser's actual absolute-URI
  proxy request — proof of real usage, not a DB-row check).
- Fingerprint reality verification (User-Agent, platform, locale, languages,
  timezone, viewport, device scale) was already covered by the prior audit
  stage's E2E suite; WebGL/Canvas/Audio/WebRTC/fonts remain honestly marked
  per their actual (non-)implementation status — no changes needed there.
- 5 new E2E specs (localization, applicationRestartPersistence, proxyVerification,
  plus 2 new tests in profileBrowserLifecycle) — 16 E2E scenarios total, all
  passing (1 pre-existing, documented TZ-init environmental flake absorbed by
  a new `retries: 1` in playwright.config.ts). 89 unit/integration tests
  still passing, 200-profile performance unaffected.

## Unreleased — Octo-like functional pass: bulk ops, backup/restore, list columns

- Bulk profile operations: multi-select checkboxes + a bulk action toolbar
  (Start, Stop, Clone, Delete, Export Selected, assign proxy, add tag) on the
  Profiles page. Bulk start launches in small chunks (default 4 at a time,
  configurable in Settings as "max simultaneous launches") instead of
  spawning every selected profile's Chromium process at once.
- Backup/Restore: one-click `Backup` per profile (writes full config+storage
  to `<userData>/backups/` automatically, no dialog) and a `Restore` action
  that imports from that folder — always creates a new independent profile,
  never overwrites.
- Import now accepts multiple files/folders in one dialog, isolates failures
  per item (one corrupt file doesn't abort the batch), and never collides on
  duplicate names (numbered suffix instead of overwrite). New `Export
  Selected` / `Export All` bulk export actions.
- Manual fingerprint editing: the profile editor's Fingerprint tab now has
  AUTO/MANUAL modes. MANUAL exposes editable fields only for what's verified
  to actually be enforced in the real browser (User-Agent, platform, locale,
  languages, timezone, screen, device scale, hardware concurrency, WebRTC
  mode) — no control that does nothing. AUTO adds a "Regenerate" button for a
  fresh coherent identity.
- Profile list now shows OS and Browser columns (via a single SQL join, not
  a per-row fingerprint lookup — verified still ~2ms at 200 profiles) plus
  sorting (Name/Status/Last Used).
- Browser window gained Home and DevTools toolbar buttons.
- 14 new tests (bulk operations, bulk import error isolation/dedup, one new
  E2E spec for multi-select) — 72 unit/integration + 10 E2E, all passing.

## Unreleased — fingerprint reality audit & deep browser integration

Full audit of every fingerprint property against the actual running browser
— see **`docs/FINGERPRINT_AUDIT.md`** for the complete reality matrix and the
empirical findings behind every classification. Summary:

- **Newly genuinely enforced** (previously configured-only): User-Agent,
  `navigator.platform`, `navigator.languages`/`navigator.language`,
  `hardwareConcurrency`, screen width/height, `devicePixelRatio` — all via
  Chrome DevTools Protocol `Emulation.*` overrides applied to the profile's
  webview on attach (`src/main/browser/fingerprintEnforcement.ts`), verified
  by `tests/e2e/fingerprintEnforcement.spec.ts` reading the real browser
  state (not the database).
- **WebRTC**: now uses the real `webContents.setWebRTCIPHandlingPolicy()`
  Chromium API (discovered during the audit that it's a `WebContents` method
  in this Electron version, not `Session` as older docs suggest). Honest
  limitation documented: `webrtcMode: 'disabled'` gets the strongest
  *available* policy, not true `RTCPeerConnection` removal. The diagnostics
  page now runs a real ICE-candidate leak probe rather than trusting the
  policy call succeeded.
- **Bug found and fixed**: the previous `--lang` command-line-switch-only
  locale mechanism was measured to leak the host OS's real installed
  languages into `navigator.languages`. Replaced with the CDP
  `acceptLanguage` override, verified clean.
- **Confirmed genuinely not implementable** (not merely "not done yet"):
  Canvas, AudioContext, WebGL vendor/renderer, `navigator.deviceMemory`,
  font enumeration, and media-device identity — each empirically tested
  against a live CDP session before being marked D, with the required future
  architecture documented for Canvas/Audio specifically.
- Fingerprint diagnostics page rewritten with an explicit
  PASS/MISMATCH/NOT_IMPLEMENTED/APPLIED status per property — never a
  silent pass on a coincidental value match (verified: `deviceMemory`
  happened to match during testing and was still correctly reported
  NOT_IMPLEMENTED).
- New: per-profile fingerprint snapshot (`fingerprint-snapshot.json` in the
  profile's own directory) written whenever the diagnostics page runs, for
  comparing observed fingerprints across app/Electron upgrades.
- New: `browserCompatibility.ts` flags (via an activity log entry, non-
  blocking) when a profile's fingerprint claims a different Chromium major
  version than the one actually running.
- New: consistency-engine tests for the audit brief's own named "impossible
  combination" examples, plus a CPU/RAM plausibility warning.
- 10 new tests (2 E2E + 5 consistency + 3 compatibility) — 63 unit/
  integration + 9 E2E, all passing.

## Unreleased — real browser start/stop E2E coverage + polling bug fix

- Added `tests/e2e/profileBrowserLifecycle.spec.ts`: an E2E test that clicks a
  profile's real Start button, confirms the nested per-profile Electron/
  Chromium OS process actually launches (its `browser-data` directory
  appears on disk), then Stops it and confirms teardown. This was previously
  documented as an intentional scope cut; it's now covered.
- Writing that test surfaced a real bug: `ProfilesPage` never re-polled after
  Start/Stop, so the UI could visibly freeze on STARTING/STOPPING even after
  the profile had actually finished transitioning in the database. Fixed with
  a 1s poll that runs only while a profile is in a transitional state.
- Completed a Stage 23 final-QA pass against the original brief's acceptance
  checklist — see PLAN.md for the full item-by-item result. 7/7 E2E, 55/55
  unit/integration, 6/6 performance tests passing; both tsconfigs and ESLint
  clean.

## Unreleased — profile editor UI

- `ProfileEditorModal` with General/Fingerprint/Proxy/Storage/Advanced tabs:
  view and rename a profile, view every fingerprint field and run
  `fingerprint:validate` against it, assign/change/clear a proxy, clear cache,
  and see storage path + timestamps. Opened via a new "Edit" button per row.
- New `fingerprint:get` IPC channel to support the editor.
- Extended the E2E suite with a 5th/6th test covering the editor end-to-end
  (open, view fingerprint, validate, rename, save) — 6/6 e2e tests passing,
  55/55 unit/integration tests still passing.

## Unreleased — Windows installer

- Fixed `electron-builder` packaging on Windows without Developer Mode/admin
  (`signAndEditExecutable: false`, documented in DEVELOPMENT.md) and produced
  a real NSIS installer: `release/ProfileForge Setup 0.1.0.exe`.
- Verified: the packaged app launches cleanly, `database/migrations` is
  correctly bundled as an extra resource and used via the `app.isPackaged`
  code path, and `profileforge.db` is created under `%APPDATA%/ProfileForge`
  — outside the install directory.
- Added the `author` field electron-builder required.

## Unreleased — E2E harness, performance benchmark

- Playwright + `_electron` E2E harness (`tests/e2e/profileLifecycle.spec.ts`,
  5 tests) driving the real built Electron app — main process, preload,
  contextBridge IPC, SQLite, and React renderer all exercised together, not
  just called in-process. `npm run test:e2e`.
- 200-profile performance benchmark (`tests/performance/profileScale.test.ts`,
  `npm run test:perf`), creating 200 real profiles+fingerprints through
  `ProfileManager`/repositories and measuring create/list/search/filter/
  clone/delete. Real measured numbers written to
  `tests/performance/PERFORMANCE_REPORT.md` on every run — sub-2ms for
  list/search/filter at 200 profiles, ~170ms to create all 200.

## Unreleased — settings, filtering, security suite

- Settings repository (defaults-merged, corrupted-key-resilient key/value
  store over the `settings` table) + Settings page: hardware acceleration
  (actually applied via `app.disableHardwareAcceleration()` before `ready`,
  not just stored), auto cache cleanup, cache limit, startup behavior, log
  retention.
- Profiles page: status filter, tag filter (backend `profiles:list` already
  supported `tag`; now wired to a dropdown), template selector at creation.
- Dedicated adversarial security test suite (`tests/unit/security.test.ts`,
  19 tests): malformed IPC payloads across 8 channels, 5 path-traversal
  variants, malformed/prototype-polluted import manifests, DB foreign-key
  corruption resistance.
- 22 new tests overall — 55/55 passing.

## Unreleased — diagnostics, templates, import/export

- Fingerprint diagnostic page (`profileforge://fingerprint-test`), served by a
  custom protocol handler registered on each profile's own session, comparing
  configured vs. observed navigator/WebGL/canvas values. Reachable via a
  toolbar button in the per-profile browser shell. Deliberately shows
  mismatches on fields not yet enforced rather than hiding them.
- 6 built-in profile templates (Windows Desktop/Germany/France/Ukraine, macOS
  Desktop, Linux Desktop), seeded idempotently at startup; profile creation
  can now target a template to constrain OS/locale.
- Versioned, Zod-validated profile export/import
  (`src/shared/schemas/exportFormat.ts`, `src/main/profiles/importExport.ts`):
  config-only export (single JSON, no secrets) and full export (manifest +
  copied browser-data folder via a native folder-picker dialog). Import
  always creates a new profile with a freshly generated ID/directory; it never
  overwrites an existing one.
- 8 new tests (templates, export schema validation) — 33/33 passing.

## Unreleased — initial foundation

- Initialized project: Electron + React + TypeScript + Vite + better-sqlite3 +
  Zod + Vitest + ESLint + Prettier + electron-builder.
- SQLite schema + migration runner (`fingerprints`, `proxies`, `profiles`,
  `tags`/`profile_tags`, `templates`, `settings`, `activity_logs`).
- Path-traversal-safe per-profile persistent storage
  (`src/main/storage/profileStorage.ts`).
- Profile lifecycle orchestration (`ProfileManager`): create, start, stop,
  restart, clone (config/full), delete, clear cache — backed by per-profile
  OS child processes with their own Chromium `userData` dir and session
  partition.
- File-based profile locking with stale-lock (dead PID) recovery.
- Coherent, seeded, deterministic fingerprint generator + cross-field
  validator (no independent randomization of OS/GPU/screen/CPU).
- Proxy manager: CRUD, TCP-reachability test, OS-encrypted password storage.
- Activity log for all profile lifecycle events.
- Zod-validated IPC contract layer; hardened `BrowserWindow` config
  (contextIsolation, no nodeIntegration, sandbox) on manager and per-profile
  windows alike.
- Minimal but functional dark-themed React UI: Profiles, Proxies, Logs pages.
- 25 unit/integration tests, all passing; both tsconfigs typecheck clean;
  ESLint clean (3 harmless unused-var warnings on intentionally-discarded
  destructured fields).
- Documentation: README, ARCHITECTURE, SECURITY, DEVELOPMENT, TESTING, PLAN.

See PLAN.md for what's intentionally not built yet.
