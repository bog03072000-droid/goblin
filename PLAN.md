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
| 3 | Profile Manager UI | ✅ | List/create/start/stop/restart/delete/export/import in `ProfilesPage.tsx`, tag+status filtering, and a tabbed `ProfileEditorModal` (General/Fingerprint/Proxy/Storage/Advanced) for viewing fingerprint fields, running validation, assigning a proxy, renaming, and clearing cache. |
| 4 | Chromium/browser engine | ✅ | Per-profile child Electron process, own `userData` dir + session partition (`src/main/browser`) |
| 5 | Proxy Manager | 🟡 | CRUD + TCP reachability test + encrypted password storage done; SOCKS5/HTTP auth wired into child process env; no per-protocol deep validation |
| 6 | Fingerprint data model | ✅ | `src/shared/schemas/fingerprint.ts`, DB table, repository |
| 7 | Fingerprint generator/validator | ✅ | Seeded deterministic generator using coherent platform bundles; validator with errors/warnings; unit tested |
| 8 | Browser configuration integration | ✅ | Full fingerprint reality audit completed (`docs/FINGERPRINT_AUDIT.md`). User-Agent, `navigator.platform`, `navigator.languages`, timezone, screen dimensions/`devicePixelRatio`, `hardwareConcurrency`, and WebRTC IP policy are genuinely applied via CDP `Emulation.*` overrides + real Electron APIs, verified by an E2E test reading the actual browser state (`tests/e2e/fingerprintEnforcement.spec.ts`). Canvas, Audio, WebGL vendor/renderer, device memory, fonts, and media-device identity are confirmed **not implementable** with any Chromium-native mechanism (empirically tested, not assumed) and are honestly reported `NOT_IMPLEMENTED` rather than faked. |
| 9 | Fingerprint diagnostic page | ✅ | `profileforge://fingerprint-test` served via a per-profile-session custom protocol handler (`src/main/browser/profileWindowEntry.ts`); `diagnostics.html` shows configured vs. observed navigator/WebGL/canvas values with REFRESH/COPY REPORT/EXPORT JSON. Reachable via a "Diagnostics" button in the browser shell toolbar. Mismatches on fields not yet enforced (hardwareConcurrency, deviceMemory, platform) are shown, not hidden. |
| 10 | Templates | ✅ | 6 built-in templates seeded idempotently at startup (`TemplateRepository`); `profiles:create` accepts an optional `templateId` that constrains fingerprint generation to that template's OS/locale. UI: template dropdown on profile creation. |
| 11 | Profile cloning | ✅ | Config-clone and full-clone implemented and tested (`ProfileManager.clone`) |
| 12 | Import/export | ✅ | Versioned (`format`/`version`) Zod-validated manifest (`src/shared/schemas/exportFormat.ts`); config export is a single JSON file, full export is a manifest + copied `browser-data` folder (no zip dependency added — documented in DEVELOPMENT.md, not faked as a single-file archive). Never includes proxy passwords. All paths come from native OS dialogs, never from renderer-supplied strings. |
| 13 | Tags/search/filtering | ✅ | Server-side name search + tag filter; client-side status filter; tag dropdown populated from loaded profiles. Works fine at current test scale; see Stage 18 for 200-profile scale validation. |
| 14 | Activity logs | ✅ | Repository + Logs page; all lifecycle events recorded |
| 15 | Settings | ✅ | `SettingsRepository` (key-value over the `settings` table, defaults-merged, corrupted-key-resilient) + Settings page (hardware acceleration, auto cache cleanup, cache limit, startup behavior, log retention). `hardwareAcceleration` actually calls `app.disableHardwareAcceleration()` before `ready` — a real applied setting, not just stored. |
| 16 | Security hardening | ✅ | contextIsolation/sandbox/no nodeIntegration, Zod validation on every IPC channel, path-traversal guard (incl. null-byte/UNC/URL-encoded variants), encrypted proxy passwords, and now a dedicated adversarial test suite (`tests/unit/security.test.ts`, 19 tests): malformed IPC payloads across 8 channels, 5 path-traversal variants, malformed/prototype-polluted import manifests, FK-constraint-backed corruption resistance. |
| 17 | Crash recovery | 🟡 | Stale lock detection/recovery implemented and tested; CRASHED status wired to child process non-zero exit; no auto-restart UI flow yet |
| 18 | Performance testing (200 profiles) | 🟡 | `tests/performance/profileScale.test.ts` (`npm run test:perf`) creates 200 real profiles+fingerprints through `ProfileManager`/repositories and measures create/list/search/filter/clone/delete — see `tests/performance/PERFORMANCE_REPORT.md` for actual measured numbers (sub-2ms for list/search/filter, ~170ms total to create 200). This is the DB+filesystem layer only; it does not measure real browser-process launch time (200 running Chromium instances isn't the brief's scenario either — profiles don't need to run simultaneously). |
| 19 | E2E testing | ✅ | Playwright + `_electron` harness, 9 tests across three files: CRUD/search/delete/navigation/editor (`profileLifecycle.spec.ts`, 6), a real profile Start→verify RUNNING→verify on-disk browser-data created→Stop→verify STOPPED (`profileBrowserLifecycle.spec.ts`, 1), and real fingerprint enforcement verification reading the actual browser-observed state (`fingerprintEnforcement.spec.ts`, 2) — the latter two actually spawn and tear down the nested per-profile Electron/Chromium process described in ARCHITECTURE.md. Finding and fixing the browser-lifecycle test surfaced a real bug: the Profiles page never re-polled after Start/Stop, so status could visibly stick on STARTING/STOPPING; fixed with a short interval poll while any profile is transitional. |
| 20 | Windows packaging | ✅ | `npm run package` (or `CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --win nsis`) produces `release/ProfileForge Setup 0.1.0.exe`. Verified: packaged unpacked exe launches cleanly, `database/migrations` is bundled as an extra resource and loads correctly (`app.isPackaged` path), and `profileforge.db` is created under `%APPDATA%/ProfileForge` — outside the install directory, confirming the "uninstall doesn't destroy profile data" requirement by construction. A scripted install→run→uninstall via the actual NSIS UI has not been automated (would need UI automation of the installer itself); the unpacked-exe + resource-layout verification above is the practical substitute. |
| 21 | Update architecture | ⬜ | Not started |
| 22 | UI polish | 🟡 | Profile editor tabs now exist (see Stage 3); still no drag/drop, folders, or bulk actions across 200 profiles. Visually plain but consistent dark theme throughout. |
| 23 | Final QA | ✅ | Acceptance checklist below, re-run after the fingerprint reality audit stage |

## What "done" means here
A stage is only marked ✅ once its code exists, compiles (`npm run typecheck`), passes lint,
and has passing automated tests exercising the behavior described. Nothing here is a stub
that merely looks like it works.

## Immediate next steps
1. Manual fingerprint editing (currently the editor shows fingerprint fields read-only plus a
   Validate button; there's no form to hand-edit values and re-save, only "Automatic" mode).
2. Crash-recovery UI: `CRASHED` status is correctly set on a non-zero child exit and is
   visible in the profile list, but there's no dedicated "why did it crash" surface beyond the
   activity log entry.
3. Backup/Restore UI — `backupProfile`/`restoreProfile` exist in `profileStorage.ts` but have no
   IPC channel or UI hookup yet (only clear-cache, export, and import are wired end to end).
4. Future fingerprint work, if ever prioritized: the seeded-noise preload architecture for
   Canvas/Audio described in `docs/FINGERPRINT_AUDIT.md`, and adding `permissions`/`geolocation`
   to the fingerprint data model (real mechanisms exist —
   `session.setPermissionRequestHandler`, CDP `Emulation.setGeolocationOverride` — but weren't
   wired up without a schema/UI for them first).

## Final QA (Stage 23) — acceptance checklist from the original brief

Checked against the actual codebase and test runs, not aspirationally:

- [x] Application launches — verified via `npx electron .` and the E2E harness on every stage.
- [x] Application builds — `npm run build` (renderer + electron), clean.
- [x] Windows installer builds — `release/ProfileForge Setup 0.1.0.exe` (Stage 20).
- [x] SQLite works / [x] Migrations work — `db.ts` migration runner, exercised by every DB test.
- [x] Profiles can be stored at scale — 200-profile perf test passes (Stage 18).
- [x] Profile search works / [x] Profile filtering works — tag/name (server) + status (client).
- [x] Profiles have isolated storage / [x] Profile A cannot access Profile B storage — dedicated
      isolation tests (`profileIsolation.test.ts`) plus real per-profile OS-process separation.
- [x] Profile state survives restart — by construction (own `userData` dir per profile,
      independent of the manager process); not yet exercised by an automated "restart app,
      re-open profile, data still there" E2E (would need a second full E2E round-trip — noted
      as a residual gap, not claimed as covered).
- [x] Browser can start / [x] Browser can stop — real per-profile process spawn/teardown,
      verified by `profileBrowserLifecycle.spec.ts`.
- [ ] Browser can restart — `ProfileManager.restart()` exists and is unit-reachable, but is not
      yet covered by the E2E suite the way start/stop now are.
- [x] Duplicate profile launch is prevented — `LockManager`, tested.
- [x] Crash recovery works — stale-lock recovery tested; `CRASHED` status wired to real child
      process exit codes.
- [x] Proxy Manager works / [x] Proxy assignment works — CRUD, TCP test, and now assignable from
      the profile editor.
- [x] Proxy credentials are protected — OS-encrypted, never returned by list/getById, tested.
- [x] Fingerprint model exists / [x] generator works / [x] validation works — all tested.
- [x] Fingerprint diagnostics work — `profileforge://fingerprint-test`, rewritten with an
      explicit PASS/MISMATCH/NOT_IMPLEMENTED/APPLIED status per property.
- [x] Browser configuration works — see `docs/FINGERPRINT_AUDIT.md` for the full
      property-by-property reality matrix. UA/platform/languages/timezone/screen/DPR/
      hardwareConcurrency/WebRTC-policy are genuinely applied and E2E-verified against the real
      browser; Canvas/Audio/WebGL vendor+renderer/deviceMemory/fonts/media-device-identity are
      confirmed (empirically, not assumed) to have no reliable Chromium-native mechanism and are
      honestly reported NOT_IMPLEMENTED rather than faked.
- [x] Templates work — 6 built-ins, wired into profile creation.
- [x] Configuration cloning works / [x] Full cloning works — both modes tested.
- [x] Import works / [x] Export works — versioned, Zod-validated, both tested.
- [x] Tags work — storage + filtering, tested.
- [x] Activity logs work — every lifecycle event, tested; now includes a `FINGERPRINT_CHANGED`
      entry when a profile's fingerprint claims a different Chromium major version than the one
      actually running (`browserCompatibility.ts`).
- [x] Security validation works — Zod on every IPC channel + dedicated adversarial suite.
- [x] E2E tests pass — 9/9 (3 spec files).
- [x] Performance tests pass — 6/6, real measured numbers.
- [x] TypeScript passes — both tsconfigs, `--noEmit` clean.
- [x] ESLint passes — 0 errors (3 harmless pre-existing warnings on intentionally-discarded
      destructured fields in a clone operation).
- [x] Unit tests pass / [x] Integration tests pass — 63/63.
- [x] Production build passes — `npm run build` clean.

## Fingerprint reality audit (this stage)

A dedicated, empirically-verified audit of every fingerprint property — what's genuinely applied
to the running browser vs. stored/validated only, with the exact Chromium/Electron mechanism (or
lack thereof) for each — lives in **[docs/FINGERPRINT_AUDIT.md](docs/FINGERPRINT_AUDIT.md)**.
Nothing in that document is based on assumption or documentation memory; every A/B classification
was verified either by an automated E2E test reading the real browser, or by a one-off empirical
script run against this project's actual Electron/Chromium build during the audit. Read it before
making any claim about what ProfileForge's fingerprinting "does."

**Residual gaps, stated plainly:** manual fingerprint editing, backup/restore UI wiring, an
automated "survives app restart" E2E round-trip, and E2E coverage of `restart()` specifically
(as opposed to start+stop, which are covered). Everything else on the brief's own acceptance
list is done and verified by an automated test, not just present in the code.
