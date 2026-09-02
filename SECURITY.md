# Security

## Scope and intent

GoblinAnty is a profile-isolation and browser-configuration tool for
legitimate use: QA/localization testing, development, and separating browser
sessions. It does not implement, and will not implement, CAPTCHA/anti-bot
bypass, authentication bypass, credential/cookie/token theft, or stealth
malware behavior. It makes no claim of guaranteed anonymity or
undetectability — see README.md and ARCHITECTURE.md for what the fingerprint
engine actually does (coherent configuration, not evasion), and
`docs/FINGERPRINT_AUDIT.md` for exactly which fingerprint properties are
genuinely enforced in the running browser versus stored-and-validated-only.

## Electron hardening

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every
  `BrowserWindow`, including per-profile child processes.
- The renderer's only bridge to the main process is
  `window.profileforge.invoke(channel, payload)`, exposed via
  `contextBridge.exposeInMainWorld` in `src/main/preload.ts`. No `fs`,
  `child_process`, `shell`, `process`, or database handle is ever exposed.
- A restrictive CSP is set in `src/renderer/index.html`
  (`default-src 'self'; script-src 'self'`).
- The per-profile webview's `preload` is force-set by the *main* process on
  `will-attach-webview` (`src/main/browser/profileWindowEntry.ts`), not left
  to the guest page to request — that preload
  (`src/main/browser/diagnosticsPreload.ts`) exposes exactly one function,
  gated to fire only when `location.protocol === 'profileforge:'`, so an
  arbitrary website loaded in the same webview cannot call it to spoof a fake
  fingerprint snapshot or spam the IPC channel.
- `webContents.debugger` (Chrome DevTools Protocol) is attached only to a
  profile's own webview `WebContents`, only to call the specific `Emulation.*`
  methods needed for fingerprint enforcement, plus
  `Page.addScriptToEvaluateOnNewDocument` for the Canvas/Audio/WebGL/Device
  Memory/Fonts/Media Devices spoofing script
  (`src/main/browser/fingerprintEnforcement.ts`) — it is never exposed to the
  renderer and grants no capability beyond those explicit CDP calls.
- The manager process can ask a per-profile child process to shut down
  gracefully over a dedicated `'ipc'` `child_process` stdio channel
  (`browserLauncher.ts` spawns with
  `stdio: ['ignore', 'ignore', 'ignore', 'ipc']`, added so Chromium's cookie/
  localStorage/IndexedDB stores get a real chance to flush before the process
  exits — see ARCHITECTURE.md). This is a new inter-process surface worth
  calling out explicitly: the child's handler recognizes exactly one message,
  the literal string `'graceful-quit'` (`profileWindowEntry.ts`), and ignores
  anything else; the channel is written to only from `ProfileManager.stop()`
  in the trusted manager process, is never forwarded to or from the renderer,
  and is not reachable from page content running inside the profile's
  webview. `stop()` still falls back to a hard `kill()` after a 3-second
  timeout if the child doesn't exit on its own, so this channel is an
  additional courtesy, not a new way for a hung process to avoid being
  terminated.

## IPC validation

Every IPC channel is registered in `src/main/ipc/registerIpc.ts` against a Zod
schema declared in `src/shared/ipc/contracts.ts`. The handler calls
`schema.parse(rawPayload)` before touching any repository or manager code —
this runs regardless of what the renderer's TypeScript types claim the
payload looks like, so a compromised or buggy renderer cannot send an
unvalidated payload into the main process.

## Path traversal

Every on-disk profile path is computed by
`src/main/storage/profileStorage.ts#resolveProfileDir`, which:
1. Rejects any profile ID that isn't a well-formed UUID (regex-checked).
2. Resolves the path and rejects it if the resolved path is not inside the
   configured profiles root.

No other code path in the app constructs a profile directory path from a
string it received from the renderer or from an import file. See
`tests/unit/profileStorage.test.ts` for the traversal/malformed-ID test cases.

## Credential storage

Proxy passwords are encrypted with Electron's `safeStorage` API (Windows
DPAPI) before being written to SQLite (`src/main/security/credentialVault.ts`,
used by `ProxyRepository`). `ProxyRepository.list()` and `.getById()` never
return the password; only the internal `.getPassword()` method does, and it is
called only when wiring up a session's proxy auth — never for logging,
display, or export.

**Known limitation:** if OS-level encryption is unavailable (rare, e.g. some
headless/CI environments), the vault falls back to a clearly-prefixed
plaintext encoding rather than silently pretending to encrypt. This is a
documented degraded mode, not a hidden one — `decryptSecret` detects and
handles both cases.

## Logging

`ActivityLogRepository` never receives passwords, cookies, tokens, or proxy
credentials — log call sites pass only IDs and human-readable messages built
from names, never from credential fields.

## Process isolation

Each running profile is a separate OS process (see ARCHITECTURE.md). A
malicious or misbehaving page in one profile cannot reach into another
profile's process memory, and a renderer crash in one profile does not affect
the manager process or other running profiles.

## Cross-profile filesystem/storage isolation

Every profile's cookies, localStorage, IndexedDB, and cache live under its
own `<userData>/profiles/<uuid>/browser-data` directory, set as that child
process's *own* Electron `userData` path before `app.whenReady()` — Chromium
itself, not application code, is what keeps one profile's session partition
(`persist:<profileId>`) from ever reading another's. This is verified
behaviorally, not just by inspecting file paths: `tests/e2e/browserTabs.spec.ts`
proves two profiles can never read each other's cookies for the same real
origin, and `tests/e2e/profileCloning.spec.ts` proves a cloned profile's
storage is independent from its source's from the moment it starts. Deleting
one profile (`deleteProfileStorage`) only ever removes that profile's own
resolved directory (see Path traversal below) — there is no code path that
constructs or touches a second profile's path while acting on the first.
Proxy configuration is likewise per-profile-row in SQLite with no shared
mutable state between profiles; `tests/e2e/proxyIsolation.spec.ts` proves
three profiles with three different proxy configurations (including "none")
each only ever use their own.

## Locking

`LockManager` prevents a profile from being started twice concurrently. A
lock file records the owning PID; on any check, if that PID is no longer
alive the lock is cleared automatically (stale-lock recovery) — but **profile
data itself is never touched by this recovery path**, only the lock file.

## Adversarial test suite

`tests/unit/security.test.ts` (19 tests) covers, specifically:
- Malformed IPC payloads across 8 different channels (wrong types, invalid
  enum values, out-of-range numbers, non-UUID ids), asserted directly against
  the same Zod schemas `registerIpc.ts` uses — not a separate reimplementation.
- 5 path-traversal variants beyond the basic `../` case in
  `profileStorage.test.ts`: trailing traversal segments, null bytes, Windows
  UNC paths, empty strings, URL-encoded traversal attempts.
- Malformed and prototype-pollution-shaped import manifests, confirming Zod's
  `.parse()` output is a clean object unaffected by an injected `__proto__`.
- Database-level corruption resistance: a lookup by a nonexistent id returns
  `null` rather than throwing; the `fingerprint_id` foreign key blocks
  creating an orphaned profile; `RESTRICT` blocks deleting a fingerprint still
  referenced by a profile.

## Not yet implemented / known gaps

- Renderer-side "attempts an unauthorized IPC channel" is enforced by
  Electron itself (`ipcMain.handle` simply has no listener for an unknown
  channel) — this is a property of the platform, not something this
  suite re-tests, since exercising it meaningfully requires a real
  Electron IPC round-trip (see the E2E gap below).
- Proxy authentication credentials are passed to the per-profile child
  process over its own `stdin`, written once by the parent immediately after
  `spawn()` and followed by `stdin.end()` (`browserLauncher.ts`); the child
  reads exactly that one line before registering its proxy-auth `'login'`
  handler or configuring the session (`profileWindowEntry.ts`'s
  `readStdinCredentials()`). This replaced an earlier environment-variable
  handoff, which stayed readable by any other process running as the same OS
  user via `/proc`/Task Manager for the child's entire lifetime — a stdin
  write is consumed once and isn't retained anywhere after that.
