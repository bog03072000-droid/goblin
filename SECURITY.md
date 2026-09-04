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

## Automation API

Any profile can optionally expose a Chrome DevTools Protocol (CDP) endpoint
while it's running, so it can be driven directly by Puppeteer, Playwright,
Selenium, or a raw CDP client (`src/main/browser/automationProxy.ts`,
enabled per profile from the editor's Advanced tab, off by default). This is
a new local network listener, so it's worth stating precisely what it does
and does not expose:

- **Raw CDP has no authentication anywhere in its own wire protocol.**
  `--remote-debugging-port`'s HTTP JSON endpoints and its WebSocket both
  accept any local connection with no token slot to add one to — this is
  true of every Chromium-based browser's debug port, not specific to this
  app. A token that isn't enforced at the actual connection level would be
  security theater, not a real access control.
- So this puts a real authenticated reverse proxy in front of Chromium's own
  debug port instead of exposing it directly. The **real** internal CDP port
  is bound to `127.0.0.1` on a random ephemeral port that is never told to
  anything but this proxy — not stored, not logged, not reachable from the
  configured (user-visible) port. The **configured** port — the one the user
  sets and a client connects to — is this proxy's own listener, also bound
  to `127.0.0.1` only, never `0.0.0.0`; it is not reachable from another
  machine on the network under any configuration this app exposes.
- **Every request is token-checked before anything is forwarded**: each HTTP
  request and the WebSocket upgrade handshake must present the correct
  token (as a `?token=` query parameter or an `Authorization: Bearer`
  header), compared with `crypto.timingSafeEqual` (length-checked first so
  unequal-length inputs never reach it, rather than throwing). A missing or
  wrong token gets a real `401` before the request ever reaches the real CDP
  port — verified end to end in `tests/e2e/automationApi.spec.ts` (real HTTP
  requests from a separate OS-level process against a real running profile)
  and `tests/unit/automationProxy.test.ts` (including a raw WebSocket
  upgrade attempt with no token, confirmed rejected before any byte reaches
  the internal port).
- Once authenticated, the WebSocket connection is proxied as a raw TCP byte
  pipe — CDP's own frame protocol is never parsed or reinterpreted by this
  proxy in either direction, so the proxy itself can't become a source of
  CDP-compatibility bugs, and it can't selectively filter or rewrite CDP
  commands after the token check either (this is an all-or-nothing access
  control on the whole debug port, not a fine-grained permission system).
- The token is generated per profile (`ProfileRepository.regenerateAutomationToken()`,
  a `crypto.randomUUID()`-based value), **encrypted at rest via the same
  `credentialVault` used for proxy passwords** (see Credential storage
  below — including its plaintext-fallback caveat), and is never part of
  the plain `Profile` object returned by `profiles:get`/`profiles:list`.
  It's handed to the child process over its own `stdin` on launch, the same
  mechanism proxy credentials already use, not as a CLI argument or
  environment variable (both stay readable by any other process running as
  the same OS user for the child's entire lifetime).
- **Practical implication**: anyone with the token can drive that profile's
  browser exactly as if they were Puppeteer/Playwright — read cookies,
  execute JavaScript on any open page, see everything the profile does.
  Treat it like a password (the profile editor's Automation panel says so
  explicitly). Regenerating it (same Advanced tab) immediately invalidates
  the old one.
- **What this does not change**: automation being enabled does not alter a
  profile's fingerprint configuration. A profile actually being driven over
  this API is, however, genuinely CDP-automation-detectable the same way
  any Puppeteer/Playwright session already is by a fingerprinting script
  that checks for it (`Runtime.enable` side effects and similar) — this is
  inherent to CDP automation itself, not a gap this feature introduces or
  could realistically close; see `docs/FINGERPRINT_AUDIT.md`.

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

**Fallback when OS-level encryption is unavailable (rare, e.g. some
headless/CI environments, or a Linux machine with no Secret Service
running):** the vault used to fall back to a clearly-prefixed but genuinely
unencrypted plaintext encoding. As of 2026-09-04 it falls back to a
self-managed AES-256-GCM layer instead (`encryptFallback`/`decryptFallback`
in `credentialVault.ts`), keyed from a passphrase derived from stable local
identifiers — OS hostname, platform, arch, the OS username, and this app's
own per-user data directory path, combined and run through `scrypt`. No
native dependency or hardware ID lookup is involved; every input is already
available through Node's `os` module or Electron's `app.getPath()`.

**Be honest about what this fallback actually buys you — it is real
encryption, but a meaningfully weaker guarantee than the OS keychain, not
an equivalent one:**
- The "secret" is *derivable*, not random — anything with local code
  execution under the same OS user account can reconstruct the exact same
  key from the exact same public-ish inputs (hostname, username, a known
  fixed salt). It is **not** protected by an OS-level access-control
  boundary the way DPAPI/Keychain/Secret Service entries are.
- It **does** stop the trivial attacks that plaintext didn't: opening the
  SQLite file directly (or a casual disk/backup scan) no longer reveals the
  password, and copying the DB file to a different machine or a different
  OS user account does not let the password decrypt there — the derived
  key won't match.
- It does **not** stop a determined local attacker who can already run
  code as the same OS user this app runs as — at that point they can
  derive the same key themselves. This is the same class of guarantee as,
  e.g., a browser's own unlocked profile-local credential store without a
  separate master password — "protects the file at rest from being read in
  isolation," not "protects the secret from anyone who can already act as
  this user."
- Rows written under the old plaintext fallback (before this change) are
  still read correctly (`LEGACY_PLAINTEXT_PREFIX` handling stays in
  `decryptSecret` for backward compatibility) but are not retroactively
  re-encrypted — only rows written or updated after this change get the
  AES-GCM fallback.

`decryptSecret` detects and handles all three formats (real `safeStorage`
buffers, the new AES-GCM fallback, and legacy plaintext rows) by a distinct
prefix marker on the stored buffer. This used to be a code-and-docs-only
"known limitation" with nothing surfacing it to an actual user — the
Settings page checks `safeStorage.isEncryptionAvailable()` (via the
`security:credentialEncryptionStatus` IPC channel) on load and shows a
visible warning banner whenever the app is running in this degraded mode,
so a user affected by it is actually told, not just able to read about it
here.

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
