# Goblin

A multi-profile Chromium browser for managing many persistent, isolated browser
profiles from one desktop app — proxy per profile, coherent per-profile browser
identity configuration, groups/tags, downloads history, ZIP backup/restore,
and diagnostics.

**Goblin does not claim to guarantee anonymity, undetectability, or the
bypass of any anti-abuse or anti-bot system.** It is a profile-isolation and
QA/testing tool: separate cookie jars, separate storage, separate configured
browser identity per profile — nothing more, nothing less. See
[SECURITY.md](SECURITY.md) for what is and isn't implemented.

## What it does today

**Profiles**
- Create/start/stop/restart/delete/clone persistent browser profiles, each
  with its own on-disk storage directory and its own OS-level browser process.
- Bulk operations across a selection: start/stop/restart/clone/delete/export/
  backup/assign-proxy/assign-group/add-tag/remove-tag, with a per-item
  success/failure report — one profile failing never aborts the batch, and
  bulk starts respect a configurable max-concurrent-launches setting.
- Groups and tags for organizing large profile lists, with filter/search/sort
  (including sort direction) across name, group, tag, status, and proxy.
- A right-click context menu and keyboard shortcuts (Ctrl+N/Ctrl+F/Ctrl+A/
  Delete/Enter) for the profile list, documented in Settings.
- One-click ZIP backup (config + full browser-data) to
  `<userData>/backups/`, and restore from any such archive — always creates a
  new, independent profile, never overwrites the original.

**Per-profile browser**
- A real multi-tab browser shell per profile: new/close/switch/duplicate tab,
  back/forward/reload/home, address bar, DevTools — all backed by the
  profile's own session partition, so switching tabs never reloads a page and
  closing one tab never touches another.
- A downloads history page (search, filter by profile/date, progress with
  speed/ETA, open/show-in-folder/delete/re-download), persisted in SQLite so
  it survives app restarts — not just an in-session list.

**Proxy**
- Assign an HTTP/HTTPS/SOCKS5 proxy per profile; credentials are encrypted at
  rest via the OS credential store (Windows DPAPI through Electron's
  `safeStorage`), never returned by any list/read API, never logged, never
  included in an export.
- Real, end-to-end verified proxy routing (not just "a proxy row exists in
  the database") — see [docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md)
  and `tests/e2e/proxyVerification.spec.ts`/`proxyIsolation.spec.ts` for how
  this is actually proven.

**Fingerprint**
- Generate a coherent fingerprint configuration (OS + GPU + UA + screen +
  hardware bundled together, not randomized independently) from a seed, and
  validate it for internal contradictions.
- Genuinely enforce User-Agent, `navigator.platform`, `navigator.languages`,
  timezone, screen dimensions/`devicePixelRatio`, `hardwareConcurrency`,
  device memory, Canvas and AudioContext noise (seeded, deterministic per
  profile), and WebRTC IP-handling policy in the real running browser —
  verified by automated tests that read the actual browser state, not just
  the database.
- WebGL vendor/renderer spoofing, font-enumeration restriction, and fake
  media-device lists are implemented but **opt-in and off by default** —
  each carries a real compatibility or coverage caveat, explained in the
  Fingerprint tab's own UI and in
  [docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md), which is the
  single most important document if you're evaluating what this app
  actually does versus what similar tools claim to do.
- A per-profile diagnostics page reports every field as
  PASS/MISMATCH/NOT_IMPLEMENTED/APPLIED against what the real browser
  observes — never a silent false pass on an unenforced field.

**Other**
- Full activity log of profile lifecycle events, plus a per-profile
  fingerprint snapshot written whenever its diagnostics page runs, so a
  profile's actual observed fingerprint can be compared before/after an
  Electron/Chromium upgrade.
- Ukrainian (default) and English UI, with full translation key parity
  enforced by a dedicated test.

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
npm run package
```

Produces `release/Goblin Setup <version>.exe` (NSIS, per-user install by
default, user can change the install directory). Output goes to `release/`.
Application data (profiles, the SQLite database) lives in the OS user-data
directory (`%APPDATA%/Goblin`), never inside the install directory, so
uninstalling the app does not delete profile data unless the user explicitly
removes that folder.

## Profile storage

Every profile gets `<userData>/profiles/<uuid>/browser-data`, used as that
profile's dedicated Chromium `userData` directory when its browser process is
launched. IDs are generated server-side and validated against a strict UUID
pattern before ever touching the filesystem — see
`src/main/storage/profileStorage.ts` and its tests in
`tests/unit/profileStorage.test.ts`. Cloning, backup, and restore all copy
this directory tree byte-for-byte into a fresh, independently-addressed
path — never a shared reference — verified end-to-end in
`tests/e2e/profileCloning.spec.ts`.

## Proxy management

See the Proxy Manager page in-app. Passwords are never stored in plaintext,
never logged, and never included in any export. Each profile's proxy
assignment is completely independent — verified end-to-end in
`tests/e2e/proxyIsolation.spec.ts` (three profiles, three different
configurations, each proven to use only its own).

## Fingerprint architecture

See [ARCHITECTURE.md](ARCHITECTURE.md#fingerprint-engine). The generator picks
one coherent platform+locale bundle per profile rather than mixing randomized
fields, and the validator flags cross-field contradictions (e.g. a Windows OS
paired with a macOS platform string). It does not and cannot guarantee that a
given fingerprint is unique or undetectable. See
[docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md) for the full
property-by-property reality matrix (what's genuinely applied to the running
browser vs. stored-and-validated only), including a final summary table of
every supported field's actual enforcement status.

## Known limitations (current build)

- **Fonts**: `fontsMode: 'restricted'` (opt-in, off by default) blocks
  `document.fonts.check()` and the Local Font Access API, but not the more
  common CSS-fallback-width-measurement font-detection technique — that
  would require either a Chromium patch or a real per-profile OS-level font
  directory, not something reachable from an injected page script without
  breaking real page layout. Re-investigated and documented in detail in
  [docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md); kept as
  partial-coverage rather than silently claimed as complete.
- **WebGL vendor/renderer spoofing**: opt-in, off by default, because
  overriding `getParameter()` for `UNMASKED_VENDOR_WEBGL`/
  `UNMASKED_RENDERER_WEBGL` carries real compatibility risk for sites that
  branch rendering logic on the reported GPU (some games, map renderers,
  CAPTCHAs). Verified end-to-end in both states — off (honestly reports the
  real GPU) and on (reports the configured value while leaving unrelated
  WebGL capabilities, e.g. `MAX_TEXTURE_SIZE`, unaffected).
- **Media device identity**: `mediaDevicesMode: 'hidden'` (opt-in, off by
  default) returns a seeded synthetic device list instead of the real one.
- **Permissions and Geolocation** are not represented in the fingerprint
  data model at all yet — no schema field, no UI, no enforcement.
- WebRTC leak protection uses Chromium's real `setWebRTCIPHandlingPolicy`,
  but there is no Chromium policy that fully disables the `RTCPeerConnection`
  API — `webrtcMode: 'disabled'` gets the strongest *available* protection,
  not a true API removal. Documented in the audit doc.
- No manual fingerprint hand-editing in the UI for spoofing-only fields
  (Canvas/Audio/WebGL/Fonts/Media Devices are toggled by mode, not
  hand-typed); the always-enforced identity fields (UA, platform, locale,
  timezone, screen, hardware concurrency) can be hand-edited in Manual mode.
- Concurrent-launch throttling (`maxConcurrentLaunches`, default 2) staggers
  the *rate* of new process launches to avoid a startup burst — it does not
  cap the total number of profiles that end up running simultaneously once a
  bulk start completes, which is the intended behavior (the point of a bulk
  start is to eventually reach N running profiles, not to be silently
  capped). Real-world load testing measured ~585MB and ~5 OS processes per
  simultaneously running profile — see `docs/LOAD_TEST.md` for the full
  methodology and numbers.
