# Development

## Setup

```bash
npm install
```

## Native module ABI: Node vs Electron

`better-sqlite3` is a native addon compiled against a specific `NODE_MODULE_VERSION`.
Plain Node.js (used by `vitest`) and Electron's embedded Node (used when
running the app) are different versions of that ABI, so switching between
"run the tests" and "run the app" requires rebuilding the addon for the
target runtime:

```bash
npm run rebuild:node       # before: npm test / npm run test:watch
npm run rebuild:electron   # before: npm run dev:electron / npm run package / npm run test:e2e
```

Running the wrong one gives a `NODE_MODULE_VERSION` mismatch error at
startup — that's the symptom, and the fix is always one of the two commands
above.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server for the renderer only (fast UI iteration) |
| `npm run dev:electron` | Build main + launch the full Electron app |
| `npm run build` | Production build (renderer + main) |
| `npm run typecheck` | `tsc --noEmit` for both the renderer and main tsconfigs |
| `npm run lint` | ESLint over `.ts`/`.tsx` |
| `npm test` | Vitest (unit + integration) |
| `npm run test:e2e` | Playwright, driving the real built Electron app (requires `npm run build` + `npm run rebuild:electron` first) |
| `npm run package` | electron-builder → Windows installer in `release/` |

## Project layout

See ARCHITECTURE.md. In short: `src/main` (Electron main + per-profile child
process), `src/renderer` (React UI), `src/shared` (Zod schemas / IPC
contracts used by both).

## Adding a migration

Add a new `NNN_description.sql` file to `database/migrations/` (zero-padded,
higher than the last). `src/main/database/db.ts` applies any migration not
yet recorded in the internal `_migrations` table, in filename order, each in
its own transaction. Never edit an already-applied migration file — add a new
one.

## Adding an IPC channel

1. Add the request schema to `src/shared/ipc/contracts.ts`.
2. Add the handler in `src/main/ipc/registerIpc.ts` via the `handle()` helper
   — it runs `schema.parse()` on the payload before your handler body executes.
3. Call it from the renderer via `callApi('your:channel', payload)`
   (`src/renderer/services/api.ts`).

Never add a new way for the renderer to reach the main process — this is the
only bridge, by design (see SECURITY.md).

## Packaging: "Cannot create symbolic link" during `electron-builder`

electron-builder unconditionally downloads and extracts a shared
`winCodeSign` tool package (used for cross-platform code-signing support)
even for an unsigned Windows-only build. That archive contains macOS-style
symlinks, and extracting them requires either Administrator privileges or
Windows Developer Mode enabled — without either, 7-Zip fails with
`ERROR: Cannot create symbolic link : A required privilege is not held by the client.`
on `darwin/.../lib/*.dylib` entries, and the build fails.

This project's `build.win.signAndEditExecutable` is set to `false` in
`package.json`, which avoids the specific `rcedit` step that needed the
extraction in practice. If you still hit the error, either:

- run `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis`
  (skips code-signing identity auto-discovery), or
- enable Windows Developer Mode (Settings → Privacy & security → For
  developers) so unprivileged symlink creation is allowed, then retry.

This is an electron-builder/Windows environment quirk, not a ProfileForge
bug — verified working (installer built successfully, packaged app launches,
`profileforge.db` is created under `%APPDATA%/ProfileForge`, not the install
directory) with the `signAndEditExecutable: false` config alone.

## Auto-updates (electron-updater)

`autoUpdater.checkForUpdatesAndNotify()` runs once, on launch, only in a
packaged build (`app.isPackaged` — an unpackaged dev run has no real
version/feed to check against, see `setUpAutoUpdater()` in `src/main/main.ts`).
It reads its update feed from `build.publish` in `package.json`, currently:

```json
"publish": {
  "provider": "github",
  "owner": "bog03072000-droid",
  "repo": "goblin"
}
```

This points at the project's real GitHub repository — electron-updater
checks that repo's Releases for a newer tagged version and its published
installer asset. `npm run package` (which runs `electron-builder` without
`--publish`) never uploads anything on its own; publishing a release is a
separate, explicit step (`electron-builder --publish always`, typically run
from CI with a `GH_TOKEN` env var set) — this project does not wire that up
automatically, so a maintainer stays in control of when a release actually
goes out.

**This config alone does not make auto-updates work yet.** electron-updater
only finds something to update to once a tagged Release with a published
installer asset actually exists on `bog03072000-droid/goblin` — until the
first `electron-builder --publish always` run (which needs a `GH_TOKEN`
with `repo` scope, e.g. a GitHub Personal Access Token or `gh auth token`,
set in the environment that runs it), `checkForUpdatesAndNotify()` will
simply find no releases and do nothing. Setting up that token/CI step is a
separate, deliberate decision for whoever manages releases — not done here.

If GitHub Releases isn't where you want to host updates, swap the whole
block for a `"provider": "generic"` config instead:
```json
"publish": { "provider": "generic", "url": "https://your-download-host/updates/" }
```
electron-updater doesn't care which provider you use as long as the feed at
that URL follows the format `electron-builder` itself produces (the
`latest.yml` file next to the installer in `release/` after packaging).

When an update finishes downloading, the app shows an in-app banner
("A new version is ready — Restart & Install", see `App.tsx`) in addition to
electron-updater's own native OS notification — clicking it calls
`autoUpdater.quitAndInstall()` via the `pf:update-install` IPC channel.

## Code signing (you'll need to do this part yourself)

The installer this project currently produces is **unsigned** — Windows
SmartScreen will warn anyone who downloads it that it's from an "unknown
publisher." Fixing that requires a real code-signing certificate, which
isn't something that can be automated here (it costs money and requires
verifying your identity/organization with a Certificate Authority). Once you
have one:

1. **Get a certificate.** An "OV" (Organization Validation) or "EV" (Extended
   Validation) Authenticode certificate from a CA such as DigiCert, Sectigo,
   or SSL.com — a few hundred dollars/year. EV certs skip SmartScreen's
   reputation-building period; OV certs still need to build up reputation
   over time before warnings stop, but are cheaper. You'll receive either a
   `.pfx`/`.p12` file (password-protected) or a physical/cloud HSM token
   (EV certs are often hardware-bound and can't just be a portable file).
2. **Set two environment variables** before running `npm run package` —
   electron-builder picks these up automatically, **no code or config change
   needed**:
   - `CSC_LINK` — either a filesystem path to your `.pfx` file, or the file's
     contents base64-encoded (useful for CI secrets where a file path isn't
     convenient).
   - `CSC_KEY_PASSWORD` — the `.pfx` file's password.
3. **Re-check `build.win.signAndEditExecutable: false`** (see the
   "Cannot create symbolic link" section above) — it was set specifically to
   route around a Windows Developer-Mode/admin-privilege limitation on *this*
   dev machine, and as a side effect it also skips the code-signing step
   entirely, even once `CSC_LINK`/`CSC_KEY_PASSWORD` are set. Signing a real
   release build is best done from an environment where you can either set
   this back to `true` (the electron-builder default) or enable Windows
   Developer Mode / run as Administrator — a CI runner with normal
   permissions typically has neither restriction this workaround exists for.
4. **Hardware-token/EV certificates** usually can't be handed to
   electron-builder as a plain `CSC_LINK` file at all — they need
   `signtool.exe` (or an equivalent signing tool for your CA's specific HSM)
   invoked directly, which electron-builder supports via a custom
   `sign` script hook (`build.win.sign` in `package.json` pointing at a
   Node script) rather than the `CSC_LINK`/`CSC_KEY_PASSWORD` pair above —
   consult your CA's Windows/electron-builder signing instructions if you go
   this route, since the exact invocation is CA- and token-specific.

## Known dev-environment quirks

- `dist-electron/main/browser/browser-shell.html` is a plain static asset
  copied by `scripts/copy-assets.js` (run as part of `npm run build:electron`)
  since `tsc` doesn't copy non-`.ts` files. If you add another such asset,
  extend that script.
- The GPU/network-service error lines Electron prints on some headless/CI
  Windows environments (`GPU process exited unexpectedly`,
  `Network service crashed, restarting service`) are sandboxing noise from the
  environment, not app bugs — verify by checking the app otherwise starts and
  the manager window loads.
