# Changelog

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
