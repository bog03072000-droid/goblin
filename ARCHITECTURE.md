# Architecture

## Process model

ProfileForge runs as several separate OS processes, not one:

1. **Manager process** — the Electron app the user interacts with (profile
   list, proxy manager, logs). Owns the SQLite database and all repositories.
2. **One child Electron process per running profile** — spawned by
   `src/main/browser/browserLauncher.ts` via `child_process.spawn`, reusing the
   same packaged Electron binary with a `--profile-window` flag
   (`src/main/browser/profileWindowEntry.ts`). Each child:
   - calls `app.setPath('userData', <profile's browser-data dir>)` before
     `app.whenReady()`, so all of Chromium's own persistence (cookies, cache,
     IndexedDB, localStorage, history, service workers) lives under that
     profile's own directory tree — not shared, not symlinked, not merged.
   - gets its own `persist:<profileId>` session partition.
   - has its proxy applied via `session.setProxy()` / the `--proxy-server`
     switch, and proxy auth handled via the `login` event.
   - gets its timezone via the `TZ` environment variable and its locale via
     the `--lang` switch — using real Chromium/Node mechanisms rather than
     JavaScript-level spoofing, per the project's "prefer real config over
     fragile spoofing" principle.

This is why one profile's renderer/browser crashing doesn't affect any other
running profile or the manager window, and why profile data survives an app
restart or a manager crash — it's not being held in the manager's memory at
all.

## Main process modules (`src/main`)

- `database/` — `db.ts` runs migrations from `database/migrations/*.sql`
  against `better-sqlite3`; `*Repository.ts` files are the only code allowed
  to write SQL (never called directly from the renderer or from React).
- `storage/profileStorage.ts` — the *only* place a profile's on-disk path is
  computed. Every function takes a profile UUID and resolves it under a fixed
  root; anything that isn't a well-formed UUID, or resolves outside the root,
  throws. This is the path-traversal defense described in SECURITY.md.
- `profiles/profileManager.ts` — orchestrates create/start/stop/restart/
  clone/delete so that DB row, on-disk storage, lock file, and OS process
  state move together.
- `profiles/lockManager.ts` — one profile, one running instance. Detects and
  clears stale locks (dead PID) without ever touching profile data.
- `fingerprint/` — `platformProfiles.ts` (coherent OS/GPU/UA bundles),
  `generator.ts` (seeded, deterministic), `validator.ts` (cross-field
  coherence checks, not an anonymity/undetectability guarantee).
- `proxy/proxyTester.ts` — TCP-reachability check only; documented as such.
- `security/credentialVault.ts` — wraps Electron `safeStorage` (Windows DPAPI)
  for proxy passwords.
- `ipc/registerIpc.ts` — every IPC channel is registered here with a Zod
  schema from `src/shared/ipc/contracts.ts` validating the payload before any
  handler logic runs, regardless of what the renderer/preload types imply.

## Renderer (`src/renderer`)

Plain React + Vite, talking to the main process exclusively through
`window.profileforge.invoke(channel, payload)` — the single function exposed
by `src/main/preload.ts` via `contextBridge`. No `fs`, `child_process`, or
direct DB access is ever reachable from the renderer.

## Shared (`src/shared`)

Zod schemas are the single source of truth for both TypeScript types
(`z.infer`) and runtime validation, used identically on both sides of IPC.

## Fingerprint engine

The generator (`src/main/fingerprint/generator.ts`) does **not** independently
randomize OS, GPU, screen size, CPU, and RAM. It seeds a deterministic PRNG
(`seededRandom.ts`) and picks one whole `PlatformProfile` bundle
(`platformProfiles.ts`) — which fixes OS, platform string, browser-version
format, and the GPU vendor/renderer pairing together — then a separate whole
locale bundle (locale + languages + timezone together). This is what prevents
impossible combinations like a `MacIntel` platform string with an NVIDIA
Direct3D WebGL renderer.

The validator (`validator.ts`) is a second, independent check: given *any*
fingerprint (generated or hand-edited in "manual mode"), it flags hard
contradictions as errors (Windows OS + macOS platform string) and unusual-but-
possible combinations as warnings (a German locale with a US timezone). It
returns `{ valid, warnings, errors }` and makes no claim beyond internal
coherence.

## Database schema

See `database/migrations/001_init.sql`. Tables: `fingerprints`, `proxies`,
`profiles`, `tags`, `profile_tags`, `templates` (schema only, unused so far),
`settings` (schema only, unused so far), `activity_logs`. Foreign keys are on
(`PRAGMA foreign_keys = ON`); profile deletion cascades to `profile_tags` but
`RESTRICT`s on `fingerprint_id` so a fingerprint can't be deleted out from
under a profile still using it.
