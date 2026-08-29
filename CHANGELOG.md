# Changelog

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
