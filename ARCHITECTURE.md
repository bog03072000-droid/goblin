# Architecture

## Process model

Goblin runs as several separate OS processes, not one:

1. **Manager process** — the Electron app the user interacts with (profile
   list, proxy manager, groups, downloads history, logs, settings). Owns the
   SQLite database and all repositories.
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
   - gets device memory, Canvas/AudioContext noise, and (opt-in) WebGL vendor/
     renderer, font restriction, and fake media-device list applied via a
     **separate mechanism**: `injectSpoofingScript()`
     (`fingerprintEnforcement.ts`) uses CDP `Page.addScriptToEvaluateOnNewDocument`
     to run a generated script (`browser/spoofingScript.ts`) in the page's
     real main JS world on every future navigation — necessary because both
     the manager window and every profile webview run with
     `contextIsolation: true`, which would prevent a preload/contextBridge
     script from ever reaching the page's own `HTMLCanvasElement`/
     `AudioBuffer`/`WebGLRenderingContext` prototypes. See
     `docs/FINGERPRINT_AUDIT.md` for exactly what each field does, its
     seeded-determinism guarantee, and why WebGL spoofing specifically ships
     off by default.
   - gets its WebRTC IP-handling policy set via the real Chromium
     `webContents.setWebRTCIPHandlingPolicy()` API (not a homegrown leak
     "protection").
   - can be asked to shut down **gracefully**: `ProfileManager.stop()` sends
     a `'graceful-quit'` message over a dedicated `'ipc'` stdio channel
     (`browserLauncher.ts` spawns with `stdio: ['ignore','ignore','ignore','ipc']`)
     rather than only ever hard-killing the process. The child's only handler
     for that channel does `if (msg === 'graceful-quit') app.quit()` — nothing
     else is recognized, and the channel is never exposed to the renderer or
     to page content. `app.quit()` runs Electron/Chromium's normal shutdown
     sequence (`before-quit` → close windows → `will-quit`), which is what
     actually lets the per-profile cookie/localStorage/IndexedDB stores flush
     to disk before the process exits; a hard `kill()` gives Chromium no such
     chance. `stop()` falls back to a hard kill after a 3-second timeout if
     the child doesn't exit gracefully on its own (e.g. a genuinely hung
     process), so a stuck profile still gets torn down.

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
  clone/delete (and their bulk variants) so that DB row, on-disk storage,
  lock file, and OS process state move together. Bulk operations report
  per-item success/failure independently — one profile's failure never
  aborts the rest of the batch — and `bulkStart`/`bulkRestart` launch in
  small chunks (respecting the configurable `maxConcurrentLaunches` setting)
  rather than spawning every requested profile's Chromium process at once.
- `profiles/lockManager.ts` — one profile, one running instance. Detects and
  clears stale locks (dead PID) without ever touching profile data.
- `database/groupRepository.ts` — profile groups, independent of (and
  coexisting with) the free-form tag system; a profile's `groupId` is a
  nullable foreign key, never a tag under the hood.
- `database/downloadRepository.ts` — persistent download history (filename,
  path, URL, size, state, owning profile), written to directly by each
  per-profile child process's own `will-download` handler on every terminal
  outcome (completed/cancelled/failed) — the manager reads the same SQLite
  file (in WAL mode, which is what makes a second OS process safely writing
  to it a supported pattern, not a race).
- `fingerprint/` — `platformProfiles.ts` (coherent OS/GPU/UA bundles),
  `generator.ts` (seeded, deterministic), `validator.ts` (cross-field
  coherence checks, not an anonymity/undetectability guarantee),
  `browserCompatibility.ts` (flags when a profile's fingerprint claims a
  different Chromium major version than the one actually running — see
  `docs/FINGERPRINT_AUDIT.md`).
- `browser/fingerprintEnforcement.ts` — calls Chromium's CDP `Emulation`
  domain for the always-on identity fields, and `injectSpoofingScript()` for
  the CDP-injected main-world script covering device memory/Canvas/Audio/
  WebGL/Fonts/Media Devices (see Process model above). Every field either
  mechanism touches was empirically verified to work against this project's
  real Electron/Chromium build before being coded — see
  `docs/FINGERPRINT_AUDIT.md` for the verification method and results.
- `browser/spoofingScript.ts` — pure function building the injected script
  string from a profile's fingerprint row; deterministic per profile+content
  (seeded PRNG, not `Math.random()`), unit-tested directly in
  `tests/unit/spoofingScript.test.ts` without needing a real browser.
- `proxy/proxyTester.ts` — TCP-reachability check only; documented as such.
- `security/credentialVault.ts` — wraps Electron `safeStorage` (Windows DPAPI)
  for proxy passwords.
- `ipc/registerIpc.ts` — every IPC channel is registered here with a Zod
  schema from `src/shared/ipc/contracts.ts` validating the payload before any
  handler logic runs, regardless of what the renderer/preload types imply.
  This now covers 40+ channels across profiles, fingerprints, proxies,
  groups, downloads, templates, settings, and their bulk variants.
- `profiles/importExport.ts` — export/import, plus one-click ZIP backup/
  restore (`backupProfile()`/`restoreProfile()`, using `adm-zip`, a pure-JS
  zip implementation with no native rebuild step). All filesystem paths come
  from a native `dialog.showSaveDialog`/`showOpenDialog` call the user drives
  (for export/restore), or a fixed `<userData>/backups/` directory (for the
  one-click backup path, which is deliberately dialog-free so it's fast
  enough to use routinely) — never from a string handed over by the
  renderer. Export/backup manifests are validated against
  `src/shared/schemas/exportFormat.ts` on the way back in.

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
was verified, including behavioral checks like `isOverridden()` — detecting
whether a prototype method's `.toString()` still says `[native code]` — and
`canvasIsDeterministic()` — reading the same canvas content twice and
checking for byte-identical output).

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
direct DB access is ever reachable from the renderer. Pages: Profiles
(list/filter/sort/bulk/context-menu/keyboard-shortcuts), Proxies, Downloads
(history page), Logs, Settings (including a Keyboard Shortcuts reference
panel). The per-profile browser shell itself (`browser-shell.html`/`.js`) is
a separate, vanilla-JS surface — not part of the React renderer — since it
runs inside the per-profile child process, not the manager.

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
Direct3D WebGL renderer. Canvas/Audio noise mode defaults to `'noise'`
(applied); WebGL spoofing, font restriction, and media-device hiding default
to their off states (`'off'`/`'system'`/`'real'`) and require an explicit
per-profile opt-in via the Fingerprint tab's Spoofing panel.

The validator (`validator.ts`) is a second, independent check: given *any*
fingerprint (generated or hand-edited in "manual mode"), it flags hard
contradictions as errors (Windows OS + macOS platform string) and unusual-but-
possible combinations as warnings (a German locale with a US timezone). It
returns `{ valid, warnings, errors }` and makes no claim beyond internal
coherence.

## Database schema

`database/migrations/` is applied in order, tracked in a `_migrations` table
(never re-applied once recorded):

- `001_init.sql` — `fingerprints`, `proxies`, `profiles`, `tags`,
  `profile_tags`, `templates`, `settings`, `activity_logs`.
- `002_groups.sql` — `groups` table, plus `profiles.group_id` (nullable FK).
- `003_webgl_spoofing_mode.sql` — adds `fingerprints.webgl_spoofing_mode`.
- `004_downloads.sql` — `downloads` table (profile_id FK, filename, save_path,
  url, total_bytes, state, timestamps), indexed on `profile_id`/`created_at`.

Foreign keys are on (`PRAGMA foreign_keys = ON`); profile deletion cascades
to `profile_tags` and `downloads`, but `RESTRICT`s on `fingerprint_id` so a
fingerprint can't be deleted out from under a profile still using it. The
database runs in WAL mode (`journal_mode = WAL`), which is what makes it safe
for a per-profile child process to also write to the same file (recording
completed downloads) concurrently with the manager process, without the
two writers racing.
