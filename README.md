# ProfileForge

A multi-profile Chromium browser for managing many persistent, isolated browser
profiles from one desktop app — proxy per profile, coherent per-profile browser
identity configuration, activity logging, and diagnostics.

**ProfileForge does not claim to guarantee anonymity, undetectability, or the
bypass of any anti-abuse or anti-bot system.** It is a profile-isolation and
QA/testing tool: separate cookie jars, separate storage, separate configured
browser identity per profile — nothing more, nothing less. See
[SECURITY.md](SECURITY.md) for what is and isn't implemented.

## What it does today

- Create/start/stop/restart/delete/clone persistent browser profiles, each
  with its own on-disk storage directory and its own OS-level browser process.
- Assign an HTTP/HTTPS/SOCKS5 proxy per profile; credentials are encrypted at
  rest via the OS credential store (Windows DPAPI through Electron's
  `safeStorage`).
- Generate a coherent fingerprint configuration (OS + GPU + UA + screen +
  hardware bundled together, not randomized independently) from a seed, and
  validate it for internal contradictions.
- Genuinely enforce User-Agent, `navigator.platform`, `navigator.languages`,
  timezone, screen dimensions/`devicePixelRatio`, `hardwareConcurrency`, and
  WebRTC IP-handling policy in the real running browser — verified by an
  automated test that reads the actual browser state, not just the database.
  See [docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md) for exactly
  which properties are enforced, which are honestly not (Canvas, Audio,
  WebGL vendor/renderer, device memory, fonts, media device identity), and
  why — this is the single most important document if you're evaluating what
  this app actually does versus what similar tools claim to do.
- Full activity log of profile lifecycle events, plus a per-profile
  fingerprint snapshot written whenever its diagnostics page runs, so a
  profile's actual observed fingerprint can be compared before/after an
  Electron/Chromium upgrade.

See [PLAN.md](PLAN.md) for exactly which parts of the original spec are done,
partially done, or not started yet — it's kept current, not aspirational.

## Requirements

- Windows 10/11
- Node.js 22+
- npm 10+

## Install

```bash
npm install
```

better-sqlite3 is a native module and must be rebuilt for whichever runtime
you're about to use (see [DEVELOPMENT.md](DEVELOPMENT.md) — this is a normal
Electron+native-module workflow, not a project-specific quirk):

```bash
npm run rebuild:electron   # before npm run dev:electron / npm run package
npm run rebuild:node       # before npm test
```

## Development

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run rebuild:electron && npm run dev:electron
```

## Build a Windows installer

```bash
npm run build
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis
```

(`npm run package` runs the same thing without the env var — set it if
electron-builder's cache doesn't already have `winCodeSign` extracted; see
DEVELOPMENT.md if you hit a "Cannot create symbolic link" error.)

Produces `release/ProfileForge Setup <version>.exe` (NSIS, per-user install by
default, user can change the install directory). Output goes to `release/`.
Application data (profiles, the SQLite database)
lives in the OS user-data directory (`%APPDATA%/ProfileForge`), never inside
the install directory, so uninstalling the app does not delete profile data
unless the user explicitly removes that folder.

## Profile storage

Every profile gets `\<userData\>/profiles/\<uuid\>/browser-data`, used as that
profile's dedicated Chromium `userData` directory when its browser process is
launched. IDs are generated server-side and validated against a strict UUID
pattern before ever touching the filesystem — see
`src/main/storage/profileStorage.ts` and its tests in
`tests/unit/profileStorage.test.ts`.

## Proxy management

See the Proxy Manager page in-app. Passwords are never stored in plaintext,
never logged, and never included in any export.

## Fingerprint architecture

See [ARCHITECTURE.md](ARCHITECTURE.md#fingerprint-engine). The generator picks
one coherent platform+locale bundle per profile rather than mixing randomized
fields, and the validator flags cross-field contradictions (e.g. a Windows OS
paired with a macOS platform string). It does not and cannot guarantee that a
given fingerprint is unique or undetectable. See
[docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md) for the full
property-by-property reality matrix (what's genuinely applied to the running
browser vs. stored-and-validated only).

## Known limitations (current build)

- Canvas, AudioContext, WebGL vendor/renderer identity, device memory, font
  enumeration, and media-device identity are stored and validated in the
  fingerprint data model but **not enforced** in the actual browser process —
  because no reliable Chromium-native mechanism exists for them (verified
  empirically, not assumed — see
  [docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md)). The fingerprint
  diagnostic page (`profileforge://fingerprint-test`, open it via the
  "Diagnostics" button in any running profile's browser toolbar) shows this
  honestly with an explicit PASS/MISMATCH/NOT_IMPLEMENTED status per
  property, never a silent false pass.
- WebRTC leak protection uses Chromium's real `setWebRTCIPHandlingPolicy`,
  but there is no Chromium policy that fully disables the `RTCPeerConnection`
  API — `webrtcMode: 'disabled'` gets the strongest *available* protection,
  not a true API removal. Documented in the audit doc.
- Full profile export is a manifest + copied folder, not a single portable
  archive file (no zip/tar dependency was added speculatively — see
  DEVELOPMENT.md).
- No manual fingerprint hand-editing in the UI yet (the profile editor's
  Fingerprint tab is read-only plus a Validate button; only "Automatic"
  generation is exposed).
- Backup/Restore have storage-layer functions but no IPC channel or UI wiring
  yet (only clear-cache, export, and import are exposed end to end).
