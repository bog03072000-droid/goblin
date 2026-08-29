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
   - gets its timezone via the `TZ` environment variable (verified to
     actually change `Intl.DateTimeFormat().resolvedOptions().timeZone` in
     the real browser — see `docs/FINGERPRINT_AUDIT.md`).
   - gets User-Agent, `navigator.platform`, `navigator.languages`, screen
     dimensions/`devicePixelRatio`, and `navigator.hardwareConcurrency`
     enforced via Chrome DevTools Protocol `Emulation.*` overrides
     (`src/main/browser/fingerprintEnforcement.ts`), applied once the webview
     attaches and before its first real navigation. This replaced an earlier
     `--lang` command-line-switch approach that was found, during the
     fingerprint audit, to leak the host OS's real installed languages into
     `navigator.languages` — see the audit doc for the exact repro.
   - gets its WebRTC IP-handling policy set via the real Chromium
     `webContents.setWebRTCIPHandlingPolicy()` API (not a homegrown leak
     "protection").

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
  coherence checks, not an anonymity/undetectability guarantee),
  `browserCompatibility.ts` (flags when a profile's fingerprint claims a
  different Chromium major version than the one actually running — see
  `docs/FINGERPRINT_AUDIT.md`).
- `browser/fingerprintEnforcement.ts` — the only place that calls Chromium's
  CDP `Emulation` domain to actually apply fingerprint fields to a running
  `WebContents`. Every field it touches was empirically verified to work
  against this project's real Electron/Chromium build before being coded —
  see `docs/FINGERPRINT_AUDIT.md` for the verification method and results.
- `proxy/proxyTester.ts` — TCP-reachability check only; documented as such.
- `security/credentialVault.ts` — wraps Electron `safeStorage` (Windows DPAPI)
  for proxy passwords.
- `ipc/registerIpc.ts` — every IPC channel is registered here with a Zod
  schema from `src/shared/ipc/contracts.ts` validating the payload before any
  handler logic runs, regardless of what the renderer/preload types imply.
- `profiles/importExport.ts` — export/import. All filesystem paths come from
  a native `dialog.showSaveDialog`/`showOpenDialog` call the user drives, never
  from a string handed over by the renderer. Export manifests are validated
  against `src/shared/schemas/exportFormat.ts` on the way back in.

## Fingerprint diagnostics

`src/main/browser/profileWindowEntry.ts` registers `profileforge://` as a
privileged, standard scheme (via `protocol.registerSchemesAsPrivileged`,
before `app.whenReady()`) and handles it on the *profile's own session*
(`ses.protocol.handle`, not the default session) so it's only reachable from
inside that profile's browser window, serving exactly one page —
`diagnostics.html` — at `profileforge://fingerprint-test`. The configured
fingerprint values are passed in as a base64-encoded query parameter computed
by `browserLauncher.ts`; the page's own script reads the real
`navigator`/`screen`/`Intl`/WebGL/`RTCPeerConnection` values and renders a
`PASS`/`MISMATCH`/`NOT_IMPLEMENTED`/`APPLIED` status per property against a
fixed classification (never derived from whether values happen to coincide —
see `docs/FINGERPRINT_AUDIT.md` for why that distinction matters and how it
was verified). This is intentionally the "document it, don't fake it"
mechanism the project brief calls for wherever a fingerprint field isn't
enforced at the Chromium/OS level (Canvas, Audio, WebGL vendor/renderer,
device memory, fonts, media device identity — full list in the audit doc).

The page's report is also sent back to the main process via a narrow preload
bridge (`src/main/browser/diagnosticsPreload.ts`, gated to the
`profileforge://` origin so an arbitrary browsed page can't call it) and
written to `<profile directory>/fingerprint-snapshot.json` — a technical-only
snapshot (no page content/cookies/history) that lets a profile's actual
observed fingerprint be compared before and after an app/Electron upgrade.

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
