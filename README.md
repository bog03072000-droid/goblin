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

**v0.4.0 — Windows-verified end to end (development and every automated
test); macOS and Linux build and pass a real smoke test on CI, but have no
local dev/test history on either platform.** Every install path, E2E-tested
workflow, and manual smoke test in this project's own development so far
happened on Windows 10/11 (see the win32-specific process/RAM measurement
code throughout `tests/`) — that is the only platform this app has actually
been *used* on. Both other platforms are unsigned/unnotarized packages
(see [DEVELOPMENT.md](DEVELOPMENT.md)'s Code signing section for real,
currently-free options being pursued) verified only by
`.github/workflows/ci.yml`'s `package-macos`/`package-linux` jobs on real
`macos-latest`/`ubuntu-latest` GitHub Actions runners: each builds the real
unsigned package (`.zip` for macOS, `AppImage`+`.deb` for Linux) and
smoke-tests it by actually launching the packaged binary and confirming it
stays running, not just checking a file exists. Check those jobs' latest
runs for the current, real pass/fail rather than trusting this paragraph,
which will go stale the moment that changes — as an earlier, since-corrected
version of this same paragraph did when it claimed Linux had "no plan to
add one."

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
- Import a [GoLogin](https://gologin.com) profile export (.json, single
  profile or an array of them) — see `src/main/profiles/competitorImport.ts`'s
  own top comment and
  [docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md)'s "Tenth
  investigation" for exactly which fields transfer (User-Agent, platform,
  screen, CPU/RAM/touch points — confirmed from GoLogin's own public API
  docs) versus which get this app's own generated defaults (WebGL, canvas
  noise, timezone — not confirmed transferable from GoLogin's format, never
  guessed). Falls back to a fully coherent generated fingerprint rather than
  ever shipping an internally-inconsistent one. Dolphin Anty's export format
  could not be verified from public documentation in this session (its docs
  are a JS-rendered SPA) — not supported, rather than guessed at.

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
  validate it for internal contradictions. Windows, macOS, and Linux
  desktop bundles, plus real Android/iOS mobile bundles (touch points,
  device pixel ratio, mobile-appropriate hardware/GPU options, real CDP
  mobile emulation so `matchMedia('(pointer: coarse)')` etc. actually
  agree) — see [docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md)'s
  "Tenth investigation" for the two real coherence bugs a live test caught
  and fixed while adding these.
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

- Windows 10/11 (the only platform this app's own development/testing has
  actually run on), macOS, or Linux (build/package/smoke-test-verified via
  CI on real hosts — see the platform-specific build sections below; no
  local dev/test history on either yet)
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

## Build a macOS package (cannot run from this Windows environment — see CI instead)

```bash
npm run package:mac
```

`build.mac` in `package.json` is configured (`zip` target, unsigned via
`identity: null`, since there's no Apple Developer identity available
here) and its JSON is valid. Running this command on this Windows machine
fails immediately with `Build for macOS is supported only on macOS` —
electron-builder refuses macOS packaging from any non-macOS host,
confirmed directly, not assumed. `.github/workflows/ci.yml`'s
`package-macos` job runs `electron-builder --mac --publish never` on a
real `macos-latest` GitHub Actions runner and smoke-tests the resulting
`.app` (`continue-on-error: true` — informational, not a merge gate).
**Confirmed passing on every run since it was added**: the build produces
a real `.zip`, and the smoke test — actually launching the packaged `.app`
and confirming it stays running, not just that a file exists — passes.
Check that job's latest run for the current, real answer rather than
trusting this paragraph, which will go stale the moment that changes.

## Build a Linux package (also verified only via CI, never run locally on Linux)

```bash
npm run package:linux
```

`build.linux` in `package.json` targets `AppImage` and `.deb`, unsigned.
Unlike macOS, electron-builder can actually cross-package a Linux target
from this Windows dev machine (confirmed directly — a `--dir`-only build
produces a real `linux-unpacked/goblinanty` binary here), but nothing in
this project has ever run that packaged binary on a real Linux host from
this machine — only `.github/workflows/ci.yml`'s `package-linux` job, on a
real `ubuntu-latest` runner, has. It runs `electron-builder --linux
--publish never` and smoke-tests the result by extracting and launching
the real `AppImage` (`--appimage-extract-and-run`, since CI images
typically lack FUSE) and confirming it stays running.
**Confirmed passing** on its first and every run since. Check that job's
latest run for the current, real answer.

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

### REST API (profile management, not a running browser)

The CDP proxy above drives an already-running profile's *browser*. A
separate, app-level REST API (`src/main/api/restApiServer.ts`) instead
drives the profile *manager* itself — create/list/get/update/delete/start/
stop a profile — the same operations the app's own UI performs, from an
external script with no UI interaction at all. Off by default; enable it in
**Settings → REST API**.

Same security posture as the automation proxy above, reusing the identical
primitives (`src/main/security/httpTokenAuth.ts`) rather than a separate
implementation: bound to `127.0.0.1` only, every request must present a
token (`?token=` query parameter or `Authorization: Bearer <token>`) checked
with `crypto.timingSafeEqual`, and repeated bad-token attempts from one
source are rate-limited (429). A wrong or missing token gets a real `401`.
Unlike the per-profile automation token — which only takes effect for a
profile process at its own launch — regenerating the REST API token restarts
the one long-lived server in the manager process immediately, so the change
takes effect right away, no profile restart needed.

**Enabling it**: Settings → REST API → check "Enable REST API" → set a port
→ copy the generated token.

**Endpoints** (JSON in, JSON out):

| Method   | Path                     | Does |
|----------|--------------------------|------|
| `GET`    | `/profiles`              | List profiles (`?search=`/`?tag=`/`?groupId=` filters) |
| `GET`    | `/profiles/:id`          | Get one profile |
| `POST`   | `/profiles`              | Create a profile — same body shape as the app's own creation modal (`name`, optional `templateId`, `proxyId`, `groupId`, `tags`, `fingerprint` overrides) |
| `PATCH`  | `/profiles/:id`          | Update fields (name, description, proxyId, groupId, tags, schedule, …) |
| `DELETE` | `/profiles/:id`          | Soft-delete (same undo window as the UI's own delete) |
| `POST`   | `/profiles/:id/start`    | Start the profile's browser process |
| `POST`   | `/profiles/:id/stop`     | Stop it |

**Example (curl):**

```bash
# List profiles
curl "http://127.0.0.1:<port>/profiles?token=<token>"

# Create one, using the "TikTok Ads Mobile" preset (see Fingerprint templates)
curl -X POST "http://127.0.0.1:<port>/profiles?token=<token>" \
  -H "content-type: application/json" \
  -d '{"name": "New Profile", "templateId": "ad-tiktok-mobile"}'

# Start it
curl -X POST "http://127.0.0.1:<port>/profiles/<id>/start?token=<token>"
```

**Example (Node, `undici`/`fetch`):**

```js
const base = 'http://127.0.0.1:<port>';
const token = '<token>';

const created = await fetch(`${base}/profiles?token=${token}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'New Profile' }),
}).then((r) => r.json());

await fetch(`${base}/profiles/${created.id}/start?token=${token}`, { method: 'POST' });
```

**Treat this token like a password too** — same practical implication as the
automation token above: anyone with it can create, modify, or delete any
profile on this machine.

### Human-like input (`humanClick`/`humanType`/`humanScroll`)

`src/shared/automation/humanInputDriver.ts` exports three helpers for
automation scripts that want mouse/keyboard/scroll input to look like a
real person's rather than a script's instant, linear actions — see
`docs/BEHAVIORAL_EMULATION.md` for the research and architecture behind
this (in short: it's a client-side layer over the CDP session you already
have, not a change to the automation proxy itself, so it works with
Puppeteer, Playwright, or a raw CDP client identically).

```js
const { chromium } = require('playwright');
const { humanClick, humanType, humanScroll } = require('./src/shared/automation/humanInputDriver');

const browser = await chromium.connectOverCDP('http://127.0.0.1:<port>?token=<token>');
const context = browser.contexts()[0];
const page = context.pages()[0];
const client = await context.newCDPSession(page);

// Moves along a curved, eased, jittered path from (100,100) to (400,300)
// (not a straight-line teleport) before clicking.
await humanClick(client, { x: 100, y: 100 }, { x: 400, y: 300 });

// Click into a field first (a real click, e.g. via humanClick or
// page.click()) so it actually has focus — humanType only dispatches key
// events into whatever's currently focused, same as CDP itself.
await humanType(client, 'hello world', { meanDelayMs: 90, stdDevMs: 30 });

// Scrolls the page 900px down in several uneven bursts with real pauses,
// rather than one instant jump to the final scroll position. `at` is
// where the wheel event lands, same as a real mouse wheel.
await humanScroll(client, { x: 400, y: 300 }, 900, { pauseProbability: 0.2 });
```

All three accept the same shape of options documented in
`humanInput.ts`/`humanInputDriver.ts`'s own JSDoc — notably `overshoot`
(mouse/scroll: a deliberate past-the-target correction),
`mistakeProbability` (typing: an occasional plausible wrong-key +
Backspace, 0/off by default), and `pauseProbability` (scroll: an
occasional extra pause simulating a moment spent reading, 0/off by
default). `CdpSession` is a one-method interface (`send(method,
params)`), so a raw `chrome-remote-interface` or plain-`ws` client works
too with a one-line adapter — it doesn't have to be Playwright's
`newCDPSession`.

**Trying it without writing a script:** every profile's own browser window
has a **"Test human input"** toolbar button — click it while any page is
loaded to see a real human-like mouse move, click, and scroll happen right
there, visually, using the exact same `humanClick`/`humanScroll` this
section documents. It's a way to confirm the feature works at all, not a
substitute for driving it programmatically from your own automation script.

## Design

Dark was the only theme through v0.1/v0.2 by deliberate choice, not an
unfinished light theme — a profile manager like this one is a tool people
keep open for long sessions alongside many other windows, and dark is
already the common default across comparable tools. Light theme support
was added once it became a real request: `src/renderer/styles/global.css`
defines a second, sage-tinted (not neutral-gray) palette under the same
custom-property structure the dark palette already used, applied either
automatically (`prefers-color-scheme: light`) or via an explicit choice in
Settings → Theme (`src/renderer/theme.ts` sets `[data-theme]` on the
document root; `System`/`Light`/`Dark`, defaulting to `System`) — exactly
the mechanism this section used to describe as the likely future path, not
a rewrite. Component CSS itself needed no changes: every rule already read
color through a token, never a hardcoded hex, which is what made this a
palette addition instead of a redesign.

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
- **Permissions and Geolocation** (`permissionsMode`/`geolocationMode`) are
  real schema fields with real UI toggles in the Fingerprint tab and real
  enforcement via CDP `Emulation.setGeolocationOverride`/permission-request
  handling — this line used to say the opposite (no schema field, no UI, no
  enforcement at all), which stopped being true once those were built and
  was simply never corrected here until now.
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
  peak RAM at the 20/50-profile scale, see
  `tests/performance/LOAD_TEST_BULKSTART_RAW.md`). At 100 simultaneous
  profiles the picture changes: a continuous free-RAM poll caught the
  system coming within ~90MB of total memory exhaustion at both
  concurrency 2 and 4 (a risk of OS-level instability, not an app
  failure — the app itself completed cleanly with 0 failures/0 orphans
  every time), while concurrency 8 finished faster and never dropped
  below ~4GB free in the same run. **8 is the safer choice at 100+
  simultaneous profiles on a machine with limited free RAM at rest**
  (that finding's own machine had ~13GB total) — a re-run on a
  ~31GB-total-RAM machine found 0 risk signal at *any* concurrency,
  including 2, confirming this specific recommendation scales with the
  machine's own headroom rather than being a universal rule. See
  `docs/LOAD_TEST.md` for the full 20/50/100-profile × 2/4/8-concurrency
  matrix across both machine classes. This staggers
  the *rate* of new process launches to avoid a startup burst — it does not
  cap the total number of profiles that end up running simultaneously once a
  bulk start completes, which is the intended behavior (the point of a bulk
  start is to eventually reach N running profiles, not to be silently
  capped). Real-world load testing measured ~585MB and ~5 OS processes per
  simultaneously running profile — see `docs/LOAD_TEST.md` for the full
  methodology and numbers.

## License

[MIT](LICENSE).
