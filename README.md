# GoblinAnty

A multi-profile Chromium browser for managing many persistent, isolated browser
profiles from one desktop app — proxy per profile, coherent per-profile browser
identity configuration, groups/tags, downloads history, ZIP backup/restore,
and diagnostics.

**GoblinAnty does not claim to guarantee anonymity, undetectability, or the
bypass of any anti-abuse or anti-bot system.** It is a profile-isolation and
QA/testing tool: separate cookie jars, separate storage, separate configured
browser identity per profile — nothing more, nothing less. See
[SECURITY.md](SECURITY.md) for what is and isn't implemented.

**Windows-verified, macOS-experimental (and currently unbuildable from
here), v0.1.** Every install path, E2E-tested workflow, and manual smoke
test in this project so far targets Windows 10/11 specifically (see the
win32-specific process/RAM measurement code throughout `tests/`) — that
remains the only platform this app is actually verified on.
`package.json`'s `build.mac` config (added this stage, `zip` target,
unsigned) is present and its JSON is valid, but **`electron-builder --mac`
was actually run from this Windows environment and refused outright**:
`⨯ Build for macOS is supported only on macOS, please see
https://electron.build/multi-platform-build` — confirmed directly, not
assumed; electron-builder blocks macOS packaging from any non-macOS host
categorically, regardless of target format (`zip` included, not just
`dmg`). The config exists and is ready for whoever has real macOS hardware
or a macOS CI runner to try — it has never actually produced a build, let
alone been launched or clicked through. Linux is not targeted at all — no
`build.linux` config, no plan to add one.

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

Produces `release/GoblinAnty Setup <version>.exe` (NSIS, per-user install by
default, user can change the install directory). Output goes to `release/`
— the single shared output directory for every platform this project
packages, never mixed with the `dist-electron/`/`dist-renderer/` build
output or any other working files. Application data (profiles, the SQLite
database) lives in the OS user-data directory (`%APPDATA%/GoblinAnty`),
never inside the install directory, so uninstalling the app does not delete
profile data unless the user explicitly removes that folder.

## Build a macOS package (config only — cannot run from this environment)

```bash
npm run package:mac
```

`build.mac` in `package.json` is configured (`zip` target, unsigned via
`identity: null`, since there's no Apple Developer identity available
here) and its JSON is valid. That's the extent of what's actually been
verified: running this command on this Windows machine fails immediately
with `Build for macOS is supported only on macOS` — electron-builder
refuses macOS packaging from any non-macOS host, confirmed directly, not
assumed. The config is ready for someone with real macOS hardware (or a
macOS CI runner) to run this same command and continue from there — it has
never actually produced a `.zip`, let alone been launched or clicked
through.

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

A **group** can also carry a proxy rotation pool (Manage Groups → "Proxy
pool" on a group), independent of any single profile's own assignment. A
profile with no proxy of its own that belongs to such a group gets handed
the next proxy in the pool, round-robin, freshly on every start — never
persisted onto the profile, so restarting it can genuinely rotate to the
next one. A profile's own direct proxy assignment always takes priority
over its group's pool, unconditionally.

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

## Automation

Any profile can expose a token-gated Chrome DevTools Protocol (CDP) endpoint
while it's running, so it can be driven directly by Puppeteer, Playwright,
Selenium, or any raw CDP client — not just through the app's own UI. Off by
default; enable it per profile in the profile editor's **Advanced** tab.

**Why a proxy, not the raw port.** Chromium's native `--remote-debugging-port`
has no authentication anywhere in the protocol — the plain HTTP endpoints
(`/json/version`, `/json/list`) and the CDP WebSocket itself accept commands
from anyone who can reach them, no token or handshake possible. So this
feature does not expose that port directly. Instead, `--remote-debugging-port`
is bound to a random internal port never told to anything but this app's own
proxy (`src/main/browser/automationProxy.ts`), and the port you actually
configure is a small reverse proxy in front of it: it validates a token on
every HTTP request and on the WebSocket upgrade, and only then forwards
traffic to the real internal port. The JSON discovery endpoints are rewritten
so their `webSocketDebuggerUrl` points back through the proxy (token
attached), which is why `puppeteer.connect({ browserURL })`'s normal
auto-discovery flow works with zero special-casing on the client side.

Both the proxy and the real internal CDP port are bound to `127.0.0.1` only
— never reachable from the network, only from this machine. The token is the
second layer: without it, a local process still can't do anything with the
port, matching the requirement that a wrong or missing token gets a real
`401`, not just an unenforced convention.

**Enabling it**: Advanced tab → check "Enable automation access" → set a
port → copy the generated token. Each profile that has automation enabled
needs its own free port if you plan to run more than one of them
simultaneously — the app doesn't reserve or deduplicate ports across
profiles for you, since it can't know in advance which profiles you'll
actually run together. Settings has a "Default automation port" field that
only pre-fills the suggestion when you first enable it on a profile; it
isn't enforced or unique.

**Connecting with Puppeteer:**

```js
const puppeteer = require('puppeteer-core');

const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:<port>?token=<token>',
});
const [page] = await browser.pages();
console.log(await page.evaluate(() => navigator.userAgent));
```

**Connecting with Playwright** (via `connectOverCDP`, which also just
fetches `/json/version` first):

```js
const { chromium } = require('playwright');

const browser = await chromium.connectOverCDP(
  'http://127.0.0.1:<port>?token=<token>',
);
```

**Treat the token like a password.** Anyone with it and local access to this
machine can fully control that profile — read cookies, run arbitrary
JavaScript on any open page, see everything the profile does. Regenerating
it (same Advanced tab) immediately invalidates the old one.

## Design

The UI is dark-only, by design, not an unfinished light theme. A profile
manager like this one is a tool people keep open for long sessions
alongside many other windows — a dark surface consistent with the app's own
branding (`src/renderer/styles/global.css`'s custom palette, GoblinAnty's own
icon/logo work) was chosen deliberately over building and maintaining a
second full palette for a use case (extended desktop-app sessions) where
dark is already the common default across comparable tools. If light-theme
support becomes a real user request, it's a matter of adding a
`prefers-color-scheme: light` token set to the existing CSS variable
structure — the styling is already token-based, not hardcoded per
component — rather than a rewrite.

## Known limitations (current build)

- **Fingerprint spoofing does not reach Service Workers.** Navigator fields,
  canvas/audio noise, and WebGL vendor/renderer are genuinely applied and
  E2E-verified for the main document and every dedicated/shared Worker, but
  not inside a Service Worker's own global scope — a real gap that a
  Service-Worker-based fingerprint probe (CreepJS reads part of its report
  this way) can see through, observing this machine's real GPU/navigator
  values instead of the configured ones. This is a known, permanent
  limitation of the current architecture, not an oversight — three separate
  fix attempts were built and reverted after each broke authenticated proxy
  support. See [docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md) for
  the full investigation.
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
- Concurrent-launch throttling (`maxConcurrentLaunches`, default 4 — real
  measurements across 20-100 profiles showed 4 beats 2 on both speed and
  peak RAM, see `tests/performance/LOAD_TEST_BULKSTART_RAW.md`) staggers
  the *rate* of new process launches to avoid a startup burst — it does not
  cap the total number of profiles that end up running simultaneously once a
  bulk start completes, which is the intended behavior (the point of a bulk
  start is to eventually reach N running profiles, not to be silently
  capped). Real-world load testing measured ~585MB and ~5 OS processes per
  simultaneously running profile — see `docs/LOAD_TEST.md` for the full
  methodology and numbers.
