# Changelog

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
