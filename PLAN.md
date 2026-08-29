# ProfileForge — Development Plan

This tracks the 23-stage plan from the project brief against actual status.
Updated as stages complete. See CHANGELOG.md for dated entries.

## Status Legend
- ✅ Done and tested (unit/integration tests passing)
- 🟡 Partially done / minimal implementation, documented limitations
- ⬜ Not started

## Stages

| # | Stage | Status | Notes |
|---|-------|--------|-------|
| 0 | Repo/environment init | ✅ | package.json, tsconfig×2, vite, vitest, eslint, git init |
| 1 | SQLite database + migrations | ✅ | `database/migrations/001_init.sql`, migration runner in `src/main/database/db.ts` |
| 2 | Persistent profile storage | ✅ | `src/main/storage/profileStorage.ts`, path-traversal guarded, tested |
| 3 | Profile Manager UI | 🟡 | Functional list/create/start/stop/restart/delete in `ProfilesPage.tsx`; no tags/search UI polish, no editor sections (fingerprint/proxy tabs) yet |
| 4 | Chromium/browser engine | ✅ | Per-profile child Electron process, own `userData` dir + session partition (`src/main/browser`) |
| 5 | Proxy Manager | 🟡 | CRUD + TCP reachability test + encrypted password storage done; SOCKS5/HTTP auth wired into child process env; no per-protocol deep validation |
| 6 | Fingerprint data model | ✅ | `src/shared/schemas/fingerprint.ts`, DB table, repository |
| 7 | Fingerprint generator/validator | ✅ | Seeded deterministic generator using coherent platform bundles; validator with errors/warnings; unit tested |
| 8 | Browser configuration integration | 🟡 | UA, locale, timezone (via TZ env) wired into per-profile process; canvas/audio/webrtc modes are stored/validated but not yet enforced in the child process — documented as not implemented, not faked |
| 9 | Fingerprint diagnostic page | ✅ | `profileforge://fingerprint-test` served via a per-profile-session custom protocol handler (`src/main/browser/profileWindowEntry.ts`); `diagnostics.html` shows configured vs. observed navigator/WebGL/canvas values with REFRESH/COPY REPORT/EXPORT JSON. Reachable via a "Diagnostics" button in the browser shell toolbar. Mismatches on fields not yet enforced (hardwareConcurrency, deviceMemory, platform) are shown, not hidden. |
| 10 | Templates | ✅ | 6 built-in templates seeded idempotently at startup (`TemplateRepository`); `profiles:create` accepts an optional `templateId` that constrains fingerprint generation to that template's OS/locale. UI: template dropdown on profile creation. |
| 11 | Profile cloning | ✅ | Config-clone and full-clone implemented and tested (`ProfileManager.clone`) |
| 12 | Import/export | ✅ | Versioned (`format`/`version`) Zod-validated manifest (`src/shared/schemas/exportFormat.ts`); config export is a single JSON file, full export is a manifest + copied `browser-data` folder (no zip dependency added — documented in DEVELOPMENT.md, not faked as a single-file archive). Never includes proxy passwords. All paths come from native OS dialogs, never from renderer-supplied strings. |
| 13 | Tags/search/filtering | 🟡 | Backend supports tag filter + name search; UI only exposes search box |
| 14 | Activity logs | ✅ | Repository + Logs page; all lifecycle events recorded |
| 15 | Settings | ⬜ | Placeholder page only |
| 16 | Security hardening | 🟡 | contextIsolation/sandbox/no nodeIntegration, Zod validation on every IPC channel, path-traversal guard, encrypted proxy passwords. Not yet done: dedicated security test suite (Stage 30), CSP hardening review |
| 17 | Crash recovery | 🟡 | Stale lock detection/recovery implemented and tested; CRASHED status wired to child process non-zero exit; no auto-restart UI flow yet |
| 18 | Performance testing (200 profiles) | ⬜ | Not run yet |
| 19 | E2E testing | ⬜ | Requires Playwright + Electron driver; not set up yet |
| 20 | Windows packaging | 🟡 | electron-builder config present and builds compile; installer not yet produced/verified |
| 21 | Update architecture | ⬜ | Not started |
| 22 | UI polish | ⬜ | Functional, not polished |
| 23 | Final QA | ⬜ | Pending prior stages |

## What "done" means here
A stage is only marked ✅ once its code exists, compiles (`npm run typecheck`), passes lint,
and has passing automated tests exercising the behavior described. Nothing here is a stub
that merely looks like it works.

## Immediate next steps
1. Tags/search/filtering UI polish (Stage 13) — backend already supports it.
2. Settings page (Stage 15) — general/browser/storage/privacy/performance/logging/updates sections.
3. Playwright/Electron E2E harness (Stage 19) — required before Performance testing (18) can be
   done meaningfully against a real running app rather than just the in-process repositories.
4. Security test suite (Stage 30 in the original numbering) — path traversal and malformed-IPC
   cases are covered inline today; a dedicated suite should assert the full list in the brief.
5. Windows installer production + verified install/uninstall (Stage 20).
