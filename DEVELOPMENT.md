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
npm run rebuild:electron   # before: npm run dev:electron / npm run package
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
