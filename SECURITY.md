# Security

## Scope and intent

ProfileForge is a profile-isolation and browser-configuration tool for
legitimate use: QA/localization testing, development, and separating browser
sessions. It does not implement, and will not implement, CAPTCHA/anti-bot
bypass, authentication bypass, credential/cookie/token theft, or stealth
malware behavior. It makes no claim of guaranteed anonymity or
undetectability — see README.md and ARCHITECTURE.md for what the fingerprint
engine actually does (coherent configuration, not evasion).

## Electron hardening

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` on every
  `BrowserWindow`, including per-profile child processes.
- The renderer's only bridge to the main process is
  `window.profileforge.invoke(channel, payload)`, exposed via
  `contextBridge.exposeInMainWorld` in `src/main/preload.ts`. No `fs`,
  `child_process`, `shell`, `process`, or database handle is ever exposed.
- A restrictive CSP is set in `src/renderer/index.html`
  (`default-src 'self'; script-src 'self'`).

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

## Locking

`LockManager` prevents a profile from being started twice concurrently. A
lock file records the owning PID; on any check, if that PID is no longer
alive the lock is cleared automatically (stale-lock recovery) — but **profile
data itself is never touched by this recovery path**, only the lock file.

## Not yet implemented / known gaps

- A dedicated adversarial security test suite (malformed IPC payloads beyond
  Zod's own rejection, corrupted profile metadata, database failure
  injection) does not exist yet as a standalone suite — path-traversal and
  schema-rejection are covered today via the unit tests referenced above.
- Proxy authentication credentials are currently passed to the per-profile
  child process via environment variables rather than a more tightly scoped
  IPC handshake. Environment variables are visible to other processes running
  as the same OS user via standard process-inspection tools, which is a
  narrower exposure than argv (visible more broadly) but still not perfect
  isolation. This is called out here rather than left undocumented.
