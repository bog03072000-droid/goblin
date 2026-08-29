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
