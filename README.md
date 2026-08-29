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
- Full activity log of profile lifecycle events.

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
npm run rebuild:electron
npm run package
```

Output goes to `release/`. Application data (profiles, the SQLite database)
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
given fingerprint is unique or undetectable.

## Known limitations (current build)

- No fingerprint diagnostic page yet (Stage 9 in PLAN.md).
- No templates, import/export, or Settings UI yet.
- Canvas/audio noise modes and WebRTC leak protection are stored and validated
  in the data model but **not yet enforced** in the actual browser process —
  this is called out explicitly rather than faked.
- No Playwright E2E suite yet; the current test suite covers unit +
  integration level (storage isolation, fingerprint coherence, DB
  repositories, lock recovery) with a real Electron app runtime smoke-tested
  manually, not yet automated.
- Windows installer config exists and the app builds, but the installer
  itself has not yet been produced and verified end-to-end.
