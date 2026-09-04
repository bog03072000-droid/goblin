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

**Verified working end-to-end (2026-09-04).** A tagged `v0.2.0` Release
with a published installer asset (plus its `latest.yml`/`.blockmap`) does
exist on `bog03072000-droid/goblin` — real proof, not assumed: built a
packaged installer at a locally-lowered version (`0.1.0`), ran it, and
`main.log` showed a real, complete flow — `Checking for update` → `Found
version 0.2.0` → a genuine **differential** download (block-map diffing,
`0 KB` to download since the block map matched) → `New version 0.2.0 has
been downloaded ... ready to install`. No code or config changes were
needed for this to work; `build.publish` was already correct.

Getting a *newer* release out is still the same separate, deliberate step
it always was: `electron-builder --publish always` (needs a `GH_TOKEN`
with `repo` scope, e.g. a GitHub Personal Access Token or `gh auth token`,
set in the environment that runs it) — not wired into CI automatically, so
a maintainer stays in control of when a release actually goes out.

**A trap worth knowing about, since it's what actually caused a real
"ENOENT: app-update.yml" failure during development:** `electron-builder
--dir` (the fast, installer-less target used for quick local iteration —
`release/win-unpacked/`) does **not** write `resources/app-update.yml` at
all, even though `app.isPackaged` is still `true` for a `--dir` build, so
`setUpAutoUpdater()` still runs and immediately fails looking for a file
that was never written. Only a real installer-producing target (`npm run
package`, i.e. plain `electron-builder`, or an actual `--publish` run) 
writes it. If you're testing a `--dir` build directly, either expect that
one specific ENOENT (harmless — nothing else is affected) or test the
real installer target instead when auto-update behavior specifically is
what you're checking.

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
SmartScreen shows anyone who downloads it an "unrecognized app" warning
("Windows protected your PC"), and without any signature at all, Windows
also shows a separate "Unknown Publisher" prompt on launch. These are two
different warnings from two different checks, and it matters which one
each option below actually clears:

- **"Unknown Publisher"** is an *identity* check: is this file signed by
  someone Windows can verify against a trusted root? A valid signature
  from any CA in Windows' trusted root store clears this immediately,
  self-signed or not.
- **SmartScreen's "unrecognized app"** is a *reputation* check: has this
  exact file been downloaded/run by enough people that Microsoft's
  telemetry treats it as known-good? A regular (OV) signature only starts
  that reputation clock — it does not skip it. An EV signature, or a
  service that itself vouches for identity the way EV does, skips it.

Researched this stage — no cert purchased, no signing actually done here,
this is deliberately a decision left to whoever manages a real release:

### Option A: self-signed certificate — free, but doesn't fix the problem for public downloads

A self-signed Authenticode cert (`New-SelfSignedCertificate` in
PowerShell, or `signtool` with a locally-generated one) is free and takes
minutes, but it does **not** clear either warning for someone downloading
the app from the internet: the cert doesn't chain to a trusted root, so
Windows still shows "Unknown Publisher," and SmartScreen still shows its
own warning on top of that (verified via current documentation, not
tested on this machine — self-signing changes *which* warning wording
appears, not whether one appears). It only
actually helps in one real scenario: **internal/organizational
distribution**, where an IT admin pushes your self-signed public
certificate into every target machine's Trusted Root Certification
Authorities and Trusted Publishers stores via Group Policy ahead of time
— at that point, and only for those specific machines, both warnings
clear. That's not this project's situation (public download, no fleet to
push a GPO to), and asking random public users to manually import an
unknown self-signed root certificate into their own Trusted Root store is
a real security anti-pattern worth naming plainly, not a workaround to
recommend — a trusted root you control can sign *anything*, so training
users to add one on request is the same move a real attacker would want.
Documented here for completeness/honesty, not as this project's answer.

### Option B: Azure Trusted Signing (Microsoft) — recommended: cheapest option that actually works

Microsoft's own managed signing service (renamed **Azure Artifact
Signing** in 2026; still commonly called Trusted Signing) validates your
identity once, then issues short-lived certificates (~72h, auto-renewed
daily) from Microsoft's own CA on every signing call — no `.pfx` file or
hardware token to manage yourself. As of mid-2026 pricing: **Basic tier,
$9.99/month, up to 5,000 signatures/month** (a hobby/small-project
release cadence needs nowhere near that) — a small fraction of a
traditional OV cert's per-year cost, billed monthly instead of a yearly
lump sum. It's backed by Microsoft's own reputation, which is the
practical reason it's worth naming as a *specific* recommendation instead
of just "get any cert": it clears "Unknown Publisher" like any signed
binary would, and in practice behaves like an EV cert for SmartScreen
purposes without needing an EV cert's hardware-token handling.

Caveat found while researching, not assumed: **individual-developer
enrollment is currently limited to the US and Canada** (organizational
enrollment covers the US, Canada, EU, and UK) — relevant if whoever signs
a real release isn't based in one of those regions; check
[Microsoft's current eligibility docs](https://azure.microsoft.com/en-us/products/artifact-signing)
before committing to this path over Option C.

**Wired in and ready to use (2026-09-04) — correcting an earlier, wrong
assumption in this doc.** This section used to point at an npm package
called `@azure/trusted-signing-cli` as the integration path; that package
does not exist on the npm registry at all (confirmed directly — a real
`npm install` 404s). The actual working integration is
[`electron-azure-trusted-signing`](https://www.npmjs.com/package/electron-azure-trusted-signing)
(already a devDependency), which is architecturally different from what
was originally assumed, not just a rename:

- It shells out to a bundled `jsign` (a **Java** signing tool) via
  `child_process` — a **JDK or JRE must be installed** on whatever
  machine/CI runner actually signs a release. Nothing else in this
  project needs Java; this is the one exception.
- It's wired into `package.json`'s `build.win.signtoolOptions.sign` as a
  plain string (`"electron-azure-trusted-signing"`) — electron-builder
  resolves and calls it directly. There is no `scripts/sign.js` file
  anymore; the previous version of this doc had one as a custom hook, but
  the actual signing logic now lives entirely inside the installed
  package, so a wrapper script would just be dead indirection.
- Credentials are read from a **`sign.env` file at the project root**
  (auto-created, empty, as soon as `npm install` runs — `postinstall.js`
  in the package does this — and auto-added to `.gitignore` alongside its
  companion `sign.key`, which caches the short-lived access token between
  signing calls). Fill in real values before signing a release:
  ```env
  AZURE_TENANT_ID=""
  AZURE_CLIENT_ID=""
  AZURE_CLIENT_SECRET=""
  TRUSTEDSIGNING_ACCOUNT_NAME=""
  TRUSTEDSIGNING_PROFILE_NAME=""
  ```
  (Note the env var names: `TRUSTEDSIGNING_ACCOUNT_NAME`/
  `TRUSTEDSIGNING_PROFILE_NAME` — not `AZURE_CODE_SIGNING_ACCOUNT_NAME`/
  `AZURE_CERTIFICATE_PROFILE_NAME` as an earlier draft of this doc
  guessed.) **Never commit real values** — `sign.env`/`sign.key` are
  gitignored specifically so this file can hold real secrets locally or
  be generated from CI secrets at build time, never checked in.
- Signing only actually runs when `build.win.signAndEditExecutable` is
  `true` — the default `npm run package` script deliberately leaves it
  `false` (see the "Cannot create symbolic link" section above; this dev
  machine doesn't have Developer Mode enabled, checked directly via the
  registry, so the default has to stay safe for everyday local builds).
  Use `npm run package:signed` instead — it overrides just that one flag
  for that one invocation via electron-builder's own
  `--config.win.signAndEditExecutable=true` CLI flag, from an environment
  that actually has real `sign.env` values and a working Java install (a
  normal CI runner with `actions/setup-java` typically satisfies both,
  though no CI job currently runs packaging/signing — that's a separate,
  deliberate decision for whoever sets up an actual release pipeline).
  Running `package:signed` with `sign.env` still empty fails loudly with a
  specific "Env variable ... is not set in sign.env file" error rather
  than silently producing an unsigned build — the right failure mode for
  a script whose entire point is producing a signed one.

### Option C: a traditional OV/EV Authenticode certificate from a CA

The conventional path, still the right call for an organization that
wants a certificate it fully owns rather than a subscription service:

1. **Get a certificate.** An "OV" (Organization Validation) or "EV"
   (Extended Validation) Authenticode certificate from a CA such as
   DigiCert, Sectigo, or SSL.com. Current market pricing (2026): **OV
   certs from ~$219/year** (Sectigo/Comodo) up to **~$400/year**
   (DigiCert); **EV certs from ~$369/year** (GoGetSSL) up to **~$685/year**
   (DigiCert) — EV is the pricier tier across every CA, in exchange for
   skipping SmartScreen's reputation-building period the way Option B
   also does. OV certs are cheaper but still need to build up download
   reputation over time before SmartScreen warnings stop, same as an
   unsigned build, just faster once it does. Note: as of March 2026, the
   CA/Browser Forum capped publicly-trusted certificate validity at 460
   days (~15 months) industry-wide, down from the previous 39-month
   maximum — budget for more frequent renewal than older guides assume.
   You'll receive either a `.pfx`/`.p12` file (password-protected) or a
   physical/cloud HSM token (EV certs are often hardware-bound and can't
   just be a portable file).
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

### Recommendation for this project

**Option B (Azure Trusted Signing), if the signer is US/Canada-eligible** —
lowest cost by a wide margin, no hardware token to manage, and clears
SmartScreen without an EV reputation-building wait. Fall back to **Option
C with an OV cert** otherwise; skip Option A for anything meant for public
download, it's documented above for honesty about what it does and
doesn't solve, not as a real fix.

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
