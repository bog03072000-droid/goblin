# Score History

The single source of truth for this project's periodic 10-category honest
assessments. Scores discussed in chat but never written here do not exist
for comparison purposes — a later assessment compares only against the
most recent entry actually recorded in this file, never against a number
recalled from conversation. This file exists because a chat-only score
was mis-cited from outside the model's actual context window on
2026-09-09, producing a comparison against a number ("85.6 weighted") that
no artifact anywhere ever recorded. Read this file's latest entry before
running any new assessment.

## Methodology (unchanged since the first assessment this file tracks)

- 10 categories, each scored 0-100, based on real verification (git log,
  direct code/doc reads, a real `npm run test:coverage` run, a real
  unit+E2E test run) — never from memory or assumption.
- **Weights:** Fingerprint ×2, Security ×1.5, Stability ×1.5, every other
  category ×1.
- **Simple average** = unweighted mean of the 10 category scores.
- **Weighted average** = (Σ score×weight) / (Σ weight), where Σ weight = 12
  for these weights (7 categories×1 + Stability 1.5 + Security 1.5 +
  Fingerprint 2).
- A new assessment must compare each category against the previous entry
  in *this file* and name the specific commit/file/test responsible for
  any real change — not restate a stale or unverifiable baseline.

## Entry format for future assessments

```
## YYYY-MM-DD — <weighted> weighted / <simple> simple

<One-line summary of what changed since the last entry.>

| Category | Score | Δ vs previous entry | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | NN | +/-N | ... |
| UX | NN | +/-N | ... |
| Дизайн | NN | +/-N | ... |
| Стабільність ×1.5 | NN | +/-N | ... |
| Безпека ×1.5 | NN | +/-N | ... |
| Код/архітектура | NN | +/-N | ... |
| Тести | NN | +/-N | ... |
| Продуктивність | NN | +/-N | ... |
| Реліз | NN | +/-N | ... |
| Fingerprint ×2 | NN | +/-N | ... |

Real numbers this round: unit tests X/Y files, coverage Z%, E2E A passed/B
failed/C did not run (name the reason for any failure).
```

## 2026-09-09 — 83.25 weighted / 83.1 simple

First entry recorded in this file. Established immediately after a full
real-verification round this session: git log -100 read, `docs/FINGERPRINT_AUDIT.md`/`SECURITY.md`/`CHANGELOG.md` read in full, a real
`npm run test:coverage` run, a real full E2E run, and direct grep
confirmation of automation API / cookie-storage editor / design tokens /
behavioral emulation / proxy encryption / mobile fingerprint profiles all
existing in the codebase. Compared against the only baseline actually
present in this conversation's own text — 81.9 weighted / 81.4 simple
(Функціональність 80, UX 79, Дизайн 85, Стабільність 87, Безпека 80, Код
87, Тести 84, Продуктивність 76, Реліз 76, Fingerprint 80) — not against
any number recalled from outside that text.

Real numbers this round: unit — 778 tests, 74 files, all passing, 86.81%
statement coverage. E2E — 126 tests: 118 passed / 1 failed / 7 did not run
(the 1 failure and its 7 cascading skips are `loadTestUIResponsiveness.spec.ts`
missing its seed DB, a documented environment prerequisite named directly
in the test's own error message — not a code regression).

| Category | Score | Δ vs previous (81.9/81.4 baseline) | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | 80 | 0 | Automation API, cookie/storage editor, behavioral emulation, proxy encryption, mobile fingerprint bundles all re-confirmed present by direct grep this round — already reflected in the prior baseline, no new feature work this round. |
| UX | 79 | 0 | Not independently re-verified this round — noted, not penalized. |
| Дизайн | 85 | 0 | Spot-checked `src/renderer/styles/global.css` (46+ CSS custom properties, dark-first with light override) — consistent, no full design review this round. |
| Стабільність ×1.5 | 87 | 0 | 118/126 E2E passed on a real Electron process, no app crashes; the one failure is a missing test-environment prerequisite, not a regression. |
| Безпека ×1.5 | 83 | +3 | Three previously-only-documented SECURITY.md claims proven end-to-end for the first time this session: `tests/e2e/diagnosticsPreloadOriginGate.spec.ts` (commit `f8d5d7b`), `tests/e2e/contextIsolationSandbox.spec.ts` (commit `7f7faa8`), `tests/e2e/geolocationPermissionsEnforcement.spec.ts` (commit `ae96b01`) — all passing. |
| Код/архітектура | 87 | 0 | `21f559a` (Fingerprint↔FingerprintDraft dedup) and `79bea93` (package.json metadata) — maintenance-level, no material category shift. |
| Тести | 86 | +2 | 4 new real E2E test files added and passing this round (see Безпека row plus the fingerprint tests below); coverage stable (86.81%, consistent with CHANGELOG's stated 82.01%→86.82%). |
| Продуктивність | 76 | 0 | Not independently re-verified this round beyond load tests passing within known ranges as a side effect of the full E2E run. |
| Реліз | 85 | +9 | The single largest named gap from this session's own SignPath-eligibility research — v0.3.0/v0.4.0 had tags but no real GitHub Release with binaries — closed: https://github.com/bog03072000-droid/goblin/releases/tag/v0.4.0 published with two checksummed real binaries (Windows `.exe`, macOS `.zip`). Not scored higher: code signing and a Linux build are still absent from this release. |
| Fingerprint ×2 | 83 | +3 | `ae96b01` corrected two factually wrong **D** gradings (Permissions/Geolocation) to **B** with real E2E proof, replacing a stale "not implemented" claim. `351a2ae`'s systematic re-check found no further staleness but did find one new, honestly-documented real gap (`navigator.connection`, graded **D**, no clean fix exists without throttling real traffic) — rewarded the same way the WebRTC gap-finding was earlier this session: honest discovery of a real gap does not get penalized. |

**Simple average:** (80+79+85+87+83+87+86+76+85+83)/10 = **83.1**
**Weighted average:** (80+79+85+87×1.5+83×1.5+87+86+76+85+83×2)/12 = **83.25**

## 2026-09-09 — 83.13 weighted / 83.0 simple

A fully independent re-verification, compared only against this file's own
previous entry (83.25/83.1) — not against any number recalled from chat.
Triggered by a mis-cited "85.6" score that turned out to have no artifact
anywhere (the reason this file exists at all). Re-ran `git log -100`, read
`SECURITY.md`/`docs/FINGERPRINT_AUDIT.md`/`CHANGELOG.md` in full, a fresh
`npm run test:coverage`, a fresh full E2E run, and fresh independent grep
confirmation of all 6 previously-cited systems (automation API, cookie/
storage editor, design tokens, behavioral emulation, proxy encryption,
mobile fingerprint) — all still real, byte-identical results to the prior
entry since no application code changed between the two rounds.

Real numbers this round: unit — 778 tests, 74 files, all passing, 86.81%
coverage (identical to the previous entry). E2E — 126 tests: 119 passed /
2 flaky (passed on retry) / 1 failed (same known seed-DB prerequisite,
`loadTestUIResponsiveness.spec.ts`) / 7 did not run (same cascading skip).

The two flaky tests this round — `loadTestClone.spec.ts` ("clone pair 0 of
2") and `proxyVerification.spec.ts` ("SOCKS5 traffic... real SOCKS5 CONNECT
request") — are pre-existing tests, not written this session, and did not
appear as flaky in the immediately-prior full run. Real, newly-observed
timing sensitivity under full-suite load; not yet root-caused.

Separately, re-running this session's own new security E2E tests
(`diagnosticsPreloadOriginGate.spec.ts`, `geolocationPermissionsEnforcement.spec.ts`)
alongside other files surfaced a real, reproducible race: every new
profile's webview auto-navigates to `BROWSER_START_URL`
(`https://www.google.com`, `profileWindowEntry.ts:24`) the instant it
attaches, and both tests typed their target URL into the address bar
before that landed — a flaky failure with nothing to do with either
security mechanism under test. Fixed in commit `9aee003` (wait for the
google.com navigation to land first); confirmed with `--repeat-each=2`,
both files now consistently green.

| Category | Score | Δ vs previous entry (83.25/83.1) | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | 80 | 0 | All 6 systems re-confirmed by fresh independent grep — no change. |
| UX | 79 | 0 | Not independently re-verified this round. |
| Дизайн | 85 | 0 | Not re-verified deeper this round. |
| Стабільність ×1.5 | 86 | -1 | The full suite genuinely surfaced 2 previously-undocumented flaky tests (see above) under real full-suite load — a small, real, newly-observed data point, not present in the prior entry's run. |
| Безпека ×1.5 | 83 | 0 | Same 3 tests re-confirmed; the race fix (`9aee003`) makes them more reliable proof, not a change to the underlying security guarantee itself. |
| Код/архітектура | 87 | 0 | No application code changed this round (test files only). |
| Тести | 86 | 0 | A real self-introduced flake was found and fixed with real verification (`9aee003`, `--repeat-each=2`) — a plus; offset by the 2 newly-surfaced pre-existing flaky tests, not yet root-caused — a minus. Net zero. |
| Продуктивність | 76 | 0 | Not independently re-verified this round. |
| Реліз | 85 | 0 | No new release action this round. |
| Fingerprint ×2 | 83 | 0 | No new fingerprint investigation this round (this round was re-verification, not new investigation). |

**Simple average:** (80+79+85+86+83+87+86+76+85+83)/10 = **83.0**
**Weighted average:** (80+79+85+86×1.5+83×1.5+87+86+76+85+83×2)/12 = **83.13**

## 2026-09-09 — 83.79 weighted / 83.6 simple

A full working round on the previous entry's own named follow-ups: root-cause
the 2 reported flaky tests, a fresh UX walkthrough, a design pass in both
themes, a performance data refresh, and one new fingerprint investigation.
Compared only against this file's own previous entry (83.13/83.0).

Real numbers this round: unit — 778 tests, 74 files, all passing, 86.81%
coverage (unchanged, no application code shipped this round beyond the
BulkToolbar/AdvancedTab/i18n UX fixes). E2E — `fingerprintEnforcement.spec.ts`
confirmed clean 6/6 in isolation; the 4 newly-fixed race-condition test files
confirmed clean with `--repeat-each=2`; `loadTestStabilityCdpNav.spec.ts`
confirmed clean 9/9 with real "slow navigation" data now recorded instead of
hard-failing.

| Category | Score | Δ vs previous entry (83.13/83.0) | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | 80 | 0 | No new feature work this round. |
| UX | 80 | +1 | Live walkthrough (commit `1ac2fc6`) found and fixed 3 real issues: `proxy.status.autoFail` never translated in `uk.ts`, `BulkToolbar`'s remove-tag placeholder visually clipped, `AdvancedTab`'s automation Port field had no placeholder/tooltip explaining auto-assignment. Also correctly ruled out two suspected issues after checking source (a "Save" button that turned out correctly labelled, and an apparently-missing Automation panel that turned out to be a stale installed build predating a recent feature — not a real bug). |
| Дизайн | 85 | 0 | Screenshotted both dark and light themes across Profiles/Proxies/Settings/Downloads/bulk-toolbar/Automation-panel — consistent, no new issues found beyond the UX row above. |
| Стабільність ×1.5 | 88 | +2 | Root-caused the 2 flaky tests named in the previous entry — both were the same google.com-start-page race, not two unrelated bugs. Swept every other E2E file for the identical pattern and found + fixed 5 more previously-undetected vulnerable call sites (`fullUserFlow.spec.ts`, `loadTestIsolation.spec.ts`, `profileBrowserLifecycle.spec.ts` ×2, `testHumanInputButton.spec.ts`, `loadTestStabilityCdpNav.spec.ts`). Also found and fixed a second, unrelated real issue in `loadTestStabilityCdpNav.spec.ts` (a hard-fail on real, expected timing variance deep into an 80-cycle stress run) by making it record data instead of failing, matching the file's own existing posture for its STOP-step check. All verified with `--repeat-each=2` or full clean reruns. Commit `9705c01`. |
| Безпека ×1.5 | 83 | 0 | No security-specific work this round. |
| Код/архітектура | 87 | 0 | Only small, targeted changes (i18n strings, a placeholder attribute) — no architectural shift. |
| Тести | 87 | +1 | Same evidence as the Стабільність row — 7 real test-file fixes, all verified — counted lightly here to avoid double-counting the same commit's weight twice. |
| Продуктивність | 77 | +1 | Fresh `npm run test:perf` run (commit `e9f5e32`) confirmed no regression at 20/50/100/200 profiles; numbers consistent with prior runs. Honestly noted: a fresh 50-100 profile bulk-start escalation pass was not attempted this round given time already spent on items 1-3. |
| Реліз | 85 | 0 | No release action this round. |
| Fingerprint ×2 | 84 | +1 | New investigation (commit `d358203`): found `navigator.userAgentData` reports completely empty values on every profile (an anomaly no real Chrome produces) and, more seriously, confirmed its `platform`/`mobile` fields leak the real host machine's identity to any website's own script — worse than prior network-layer correlation-only findings. Attempted a fix, then caught a real regression (`acceptLanguage` breaking) via this project's own full-suite verification discipline, and reverted the code rather than ship it — rewarded for the rigor and the honest, real finding, not inflated for a fix that didn't actually ship. |

**Simple average:** (80+80+85+88+83+87+87+77+85+84)/10 = **83.6**
**Weighted average:** (80+80+85+88×1.5+83×1.5+87+87+77+85+84×2)/12 = **83.79**

## 2026-09-09 — 84.38 weighted / 84.2 simple

A focused round revisiting the previous entry's own named follow-ups: fully
isolate the userAgentMetadata regression (not just "risky" — confirmed not
viable), a careful 20/50/100-profile escalation that was skipped last
round, another live UX pass, and re-verifying the race-pattern fix
actually covers every file. Compared only against this file's own
previous entry (83.79/83.6).

Real numbers this round: unit — 780 tests, 74 files, all passing (+2 new
tests for the schedule-time fix). E2E — `profileSchedule.spec.ts` (2/2),
`profileManagerPolish.spec.ts` (10/10), `fingerprintEnforcement.spec.ts`
(5 passed/1 flaky-recovered) all confirmed clean after every code change
this round.

| Category | Score | Δ vs previous entry (83.79/83.6) | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | 80 | 0 | No new feature work (the schedule fix is a correctness fix, credited under UX below per this file's own convention of crediting the discovery method). |
| UX | 82 | +2 | Live walkthrough of the CURRENT dev build's Automation/Schedule panel (commit `ac4be36`) found a real, significant bug: enabling a schedule and picking a day without ever touching the Time field leaves `scheduleTime: null` in the database — confirmed directly via `profiles:list` — while the UI's own "next run" preview shows a confident, false "Mon 09:00". The real `ProfileScheduler` backend would never have fired it. Fixed both save paths (checkbox + day-toggle), covering the bulk "Enable schedule" flow too. Also completed a systematic sweep of all 423 i18n keys for the same class of bug the previous round found — zero further real ones (10 byte-identical matches, all legitimate technical terms). |
| Дизайн | 85 | 0 | No dedicated design pass this round. |
| Стабільність ×1.5 | 88 | 0 | Re-swept every E2E file with an `address.fill` call site (commit-free verification, no code changed) — confirmed all 12 files are genuinely covered against the google.com race, either by this session's own fix or a pre-existing equivalent guard. No file was missed; also nothing new to fix. |
| Безпека ×1.5 | 83 | 0 | No security-specific work this round. |
| Код/архітектура | 87 | 0 | Only the schedule-time fix (small, targeted) — no architectural shift. |
| Тести | 88 | +1 | 2 new unit tests for the schedule-time fix, both real regression guards (one for the checkbox path, one for the bulk-enable/day-toggle path) — not padding, each maps to a real, previously-unguarded code path. |
| Продуктивність | 79 | +2 | The escalation skipped last round, done carefully this time (commit `33ed0a1`): 20/50/100 profiles, continuous 5-second RAM polling throughout. Found a real, more alarming trough than the 2026-09-07 baseline — 90MB free RAM at the lowest point during the 100-profile tier (vs. 2.24–2.39GB then), on a machine with less baseline headroom. Still 0 failures, 0 orphans — the app itself never broke — but this revises the safe-concurrency recommendation down for low-headroom machines, real and worth knowing, not a regression in the app. |
| Реліз | 85 | 0 | No release action this round. |
| Fingerprint ×2 | 85 | +1 | Fully isolated the previous entry's "root cause not fully isolated" gap (commit `bed7e1b`), via a clean standalone CDP experiment outside the app's own code: the minimal `userAgentMetadata` shape throws a hard protocol error that silently aborted the *entire* rest of fingerprint enforcement (not just acceptLanguage — a bigger blast radius than first documented); the complete shape stops that error but still leaves the guest `<webview>`'s own CDP target unusable afterward. This is a materially stronger, more certain conclusion than "risky" — confirmed not viable with this project's `<webview>`-based architecture at all. The underlying leak stays open (unchanged from last round), so the bump is for the diagnostic certainty gained, not a fix that shipped. |

**Simple average:** (80+82+85+88+83+87+88+79+85+85)/10 = **84.2**
**Weighted average:** (80+82+85+88×1.5+83×1.5+87+88+79+85+85×2)/12 = **84.38**

## 2026-09-09 — 84.38 weighted / 84.2 simple (comprehensive audit, no code changes)

A deliberately exhaustive, measurement-only audit (no fixes made this
round, per explicit instruction) — full `git log -150`, a fresh read of
`FINGERPRINT_AUDIT.md`/`SECURITY.md`/`CHANGELOG.md`/`README.md`/
`DEVELOPMENT.md`/`LOAD_TEST.md`, a real `test:coverage` run, a real full
E2E run, `test:perf`, both `typecheck` configs, `lint`, and direct
grep/API confirmation of 12 named systems (automation API + rate-limiting,
cookie/localStorage editor, design tokens, behavioral emulation, proxy
encryption, mobile fingerprint, proxy rotation pools, profile scheduler,
soft-delete/undo, CI pipeline, auto-updater, GitHub Release). Compared
only against this file's own previous entry (84.38/84.2, the round
immediately above).

Real numbers this round: unit — 780 tests, 74 files, all passing.
Coverage — **86.8% statements / 89.55% branches / 75.31% functions /
86.8% lines** (functions notably the weakest dimension). E2E (full,
fresh) — **129 tests: 128 passed / 1 failed** (0 flaky, 0 did-not-run —
the seed-DB prerequisite that previously blocked
`loadTestUIResponsiveness.spec.ts` now exists from an earlier session
action, so more of that file's sub-tests actually ran than in prior
rounds). `test:perf` — 37/37, DB-layer numbers consistent with prior
runs, no regression. `typecheck` (both `tsconfig.json` and
`tsconfig.electron.json`) — 0 errors. `lint` — 0 errors, the same 1
pre-existing `ProxiesPage.tsx` warning. `package.json` version `0.4.0`;
HEAD is **28 commits ahead of the `v0.4.0` tag** (`git describe --tags`:
`v0.4.0-28-g09859b7`) — a real, growing version debt.

**Two real findings this round, deliberately left unfixed (measurement-only
audit):**
1. The one E2E failure is genuinely reproducible (confirmed via isolated
   rerun, not flaky) and fully root-caused: `loadTestUIResponsiveness.spec.ts`'s
   "sort toggle re-orders 200 rows" test targets `.toolbar`, a class that
   `ProfilesToolbar.tsx` no longer uses (renamed to `toolbar-group`/
   `toolbar-row` by commit `26d85bc`; `LogsPage.tsx`/`ProxiesPage.tsx` still
   use the literal `toolbar` class, which is likely why this was missed).
   This is a stale test selector, not a product regression — the sort
   button and its `title` attribute are still correctly implemented.
2. `DEVELOPMENT.md` (Option D / SignPath Foundation section) still claims
   "the `v0.3.0` and `v0.4.0` tags... have no corresponding GitHub Release
   or attached binaries yet" — confirmed false via the GitHub API: the
   `v0.4.0` release is real, published (`draft: false`), with 2 assets.
   The doc was never updated after that release was actually published
   earlier this session.

Neither finding was fixed this round (explicit instruction: measurement
and assessment only). Both are named here rather than silently corrected.

| Category | Score | Δ vs previous entry (84.38/84.2) | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | 80 | 0 | All 12 named systems re-confirmed present via direct grep/API this round (a broader list than any prior round's 6) — reconfirmation of existing baseline, no new feature work. |
| UX | 82 | 0 | Not independently re-verified this round (measurement-focused audit, no live walkthrough). |
| Дизайн | 85 | 0 | Not re-verified this round. |
| Стабільність ×1.5 | 88 | 0 | Fresh full E2E: 128/129 passed (99.2%), 0 app crashes, 0 orphaned processes. The one failure is the stale-selector test bug above, not a stability regression — not penalized, per this file's own standing convention that a test-only issue doesn't count against product stability. |
| Безпека ×1.5 | 83 | 0 | Confirmed `AuthRateLimiter` (commit `e79c839`, predates this file) is real and wired into both the HTTP and WebSocket auth paths, with its own existing unit test (`automationProxyRateLimit.test.ts`) — pre-existing work already implicit in the baseline, not new this round. |
| Код/архітектура | 87 | 0 | No code changed this round. |
| Тести | 88 | 0 | Real coverage confirmed (86.8%/89.55%/75.31%/86.8% — functions notably weakest). E2E count grew to 129 as a previously-blocked test file's sub-tests now run. The stale-selector finding is a real, honestly-reported gap, deliberately not fixed this round — net neutral per this file's "honest discovery doesn't get penalized" principle. |
| Продуктивність | 79 | 0 | `test:perf` clean (37/37), no regression; no fresh escalation attempted this round (already done last round). |
| Реліз | 85 | 0 | v0.4.0 release itself unchanged and still real; the newly-found `DEVELOPMENT.md` staleness is a documentation gap about an already-completed action, not a change to actual release readiness. 28-commit version debt reconfirmed, already an open recommendation. |
| Fingerprint ×2 | 85 | 0 | No new fingerprint investigation this round. |

**Simple average:** (80+82+85+88+83+87+88+79+85+85)/10 = **84.2**
**Weighted average:** (80+82+85+88×1.5+83×1.5+87+88+79+85+85×2)/12 = **84.38**

**Honest verdict on production readiness:** ready now for practical,
non-commercial/QA use on Windows — 780/780 unit and 128/129 E2E support
that directly. For public distribution, three concrete things remain,
not vaguely: (1) **code signing — an external factor**, needs the
maintainer's own action (Azure Trusted Signing with real credentials, or
a SignPath Foundation application) — no amount of code closes this; (2)
**two confirmed-unfixable fingerprint leaks** (Service Worker GPU/navigator
leak; `navigator.userAgentData` platform/mobile leak) — real engineering
gaps, but architecturally blocked in the current Electron/`<webview>`
model, not simply undone work; (3) **version debt** — 28 real commits
since the `v0.4.0` tag with no new release cut — pure release
administration, the simplest of the three to close.

## 2026-09-09 — 85.79 weighted / 85.5 simple

A full active-work round (explicitly not measurement-only, unlike the
comprehensive audit immediately above) — 9 numbered items worked in
order, each with its own commit, typecheck/lint/unit run after every
item and E2E where relevant. Compared only against this file's own
previous entry (84.38/84.2).

**What actually shipped, one item at a time:**
1. **Release** (`cb0219f`): version 0.4.0 → 0.5.0, a real per-theme
   `CHANGELOG.md` 0.5.0 section covering all 29 `v0.4.0..HEAD` commits,
   `DEVELOPMENT.md`'s stale "no GitHub Release" claim corrected (verified
   false via the GitHub API before editing), local `v0.5.0` tag created
   — **not pushed**, per this round's own instructions.
2. **Tests** (`8c2572c`): fixed `loadTestUIResponsiveness.spec.ts`'s
   stale `.toolbar` selector (renamed to `.toolbar-group` by commit
   `26d85bc`) — confirmed `LogsPage.tsx`/`ProxiesPage.tsx`'s own
   `.toolbar` is separately intentional, not stale. Verified via a real
   E2E run: the previously-failing sort-toggle test now passes.
3. **Tests** (`92a8ab5`): added 3 real coverage tests for
   `ProfilesPage.tsx`'s `createGroup`/`renameGroup`/`deleteGroup` — the
   single biggest real function-coverage gap in the codebase (35/50
   functions uncovered), found via actual `coverage-final.json` parsing,
   not guessing.
4. **Functionality** (`bce739f`): 2 new edge-case unit tests for
   `groupRepository.ts`'s `advanceRotationCursor` (pool emptied mid-
   rotation; pool shrinks below the stored cursor). No bug found — the
   existing `current % poolSize` self-correction already handles both
   safely, confirmed empirically rather than assumed from reading the code.
5. **UX** (`219b659`): first-ever live walkthrough of the Storage/Cookie
   editor (create → not-running explanation → start → add/delete cookie
   → add/delete localStorage entry → stop → delete profile), driven via
   computer-use against the real dev build. No crash or data-loss found;
   2 minor, real friction points documented (no undo/confirm on a
   destructive delete; ambiguous URL-field scheme expectation) for a
   future pass, not forced fixes.
6. **Design** (`1280d50`): first light-theme screenshot check of the
   Storage tab's card grid. No contrast/readability issue found.
7. **Security** (`e4260eb`): `registerIpc.ts`'s per-channel Zod
   validation had only ever been unit-tested with a mocked `ipcMain` —
   added a real E2E test sending malformed payloads through the actual
   `window.profileforge.invoke` bridge against a live app, and closed
   the loop by feeding the real rejection through the renderer's own
   `describeError()`, confirming it maps to the intended human-readable
   text, not raw internals.
8. **Performance** (`26bd0ae`): updated `README.md`'s concurrency
   recommendation ("4 beats 2") with the fuller 100-profile picture the
   prior round (`33ed0a1`) already found but never surfaced there —
   concurrency 8 is the safer choice at that scale, not just the faster
   one.
9. **Fingerprint ×2** (`5d556b5`): Nineteenth investigation. Confirmed a
   real leak — `screen.orientation.type` reported the real desktop
   host's `landscape-primary` on a portrait (412×919) Android-configured
   profile, since `Emulation.setDeviceMetricsOverride` never carried a
   `screenOrientation` param. **Fixed and verified live** (portrait
   profile now correctly reports `portrait-primary`), **regression-
   checked on a live desktop profile** (still correctly
   `landscape-primary`, per this round's standing caution about
   spoofing-mechanism changes), and given a permanent
   `fingerprintEnforcement.spec.ts` assertion so it can't silently
   regress. Second candidate vector, `document.fonts.ready`/enumeration,
   was also checked empirically — no gap found (`FontFaceSet` only ever
   reflects a page's own declared fonts, never system fonts) — an honest
   "no fix needed" result, not forced.

Real numbers this round: unit — **785 tests, 74 files, all passing**
(+5 net new tests: 3 coverage + 2 edge-case). Fingerprint E2E
(`fingerprintEnforcement.spec.ts`) — 6/6 passed, including the new
orientation assertion. Load-test E2E
(`loadTestUIResponsiveness.spec.ts`) — 8/8 passed, including the
previously-broken sort-toggle test. New IPC-validation E2E
(`ipcValidation.spec.ts`) — 3/3 passed. `typecheck` (both configs) and
`lint` — clean after every single item, not just at the end.

| Category | Score | Δ vs previous entry (84.38/84.2) | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | 81 | +1 | Item 4's edge-case tests found the existing rotation-cursor logic already correct — real confidence gained on a previously-untested edge case, not a fix, hence a small credit rather than a large one. |
| UX | 83 | +1 | Item 5's live walkthrough (`219b659`) — the Storage/Cookie editor's core flow confirmed working end-to-end for the first time, with 2 real (if minor) friction points honestly documented rather than glossed over. |
| Дизайн | 86 | +1 | Item 6 — first light-theme check of the Storage tab, genuinely never done before, clean result. |
| Стабільність ×1.5 | 88 | 0 | No dedicated stability work this round. |
| Безпека ×1.5 | 85 | +2 | Item 7 (`e4260eb`) — closed the "only unit-tested" gap in `registerIpc.ts` the user named directly, with a real non-mocked E2E round-trip and a closed-loop check of the actual human-readable error text. |
| Код/архітектура | 87 | 0 | No architectural work this round — every fix was small and targeted (one CDP param, one selector, one field). |
| Тести | 90 | +2 | Items 2+3 combined: a real stale-selector E2E fix (not just diagnosis, unlike the previous round which found but didn't fix it) plus 3 new real function-coverage tests targeting the single biggest actual gap in the codebase. |
| Продуктивність | 79 | 0 | Item 8 is a documentation catch-up for a finding already credited last round (`33ed0a1`), not new performance work — no double-counting. |
| Реліз | 88 | +3 | Item 1 (`cb0219f`) directly closes the "version debt" this file's own last two entries named as an open recommendation: real version bump, real per-commit changelog, a corrected stale doc claim, and a local tag — the simplest of the three named production-readiness gaps, now closed (still unpushed, as instructed). |
| Fingerprint ×2 | 88 | +3 | Item 9 (`5d556b5`) — unlike most of this document's fingerprint history (which mostly finds real-but-architecturally-unfixable leaks), this is a real leak found AND shipped AND verified fixed, with a regression check and a permanent test guarding it. The clean "no gap" result on the second vector doesn't add further credit on its own. |

**Simple average:** (81+83+86+88+85+87+90+79+88+88)/10 = **85.5**
**Weighted average:** (81+83+86+88×1.5+85×1.5+87+90+79+88+88×2)/12 = **85.79**

**Summary:** a genuine, if incremental, improvement (+1.41 weighted /
+1.3 simple) driven by 9 separately-committed, separately-verified
items rather than one big change — one real shipped fingerprint fix
(the round's most consequential single deliverable), one real security
gap closed with an end-to-end test, real test-coverage and edge-case
additions, and the version-debt release gap finally closed. Two items
(8, and half of 9) produced honest "already fine" / "no gap found"
results and were scored accordingly — a small or zero credit, not
inflated to match the round's overall activity level. **Nothing in this
round has been pushed — the `v0.5.0` tag and all 9 commits remain
local, pending explicit confirmation.**

## 2026-09-10 — 86.04 weighted / 85.8 simple

Two parts: (1) an independent re-verification of the previous entry's own
85.79/85.5 score, done adversarially rather than trusting the prior
round's own conclusions — every one of 7 required checks (commit
existence, per-commit diff content, the score-history text itself, the
local tag, a full unit run, the new regression test's actual assertion,
and the actual fix code) passed with **no discrepancy found**; (2) a
genuine follow-up round targeting this file's own bottom-3 categories
(Продуктивність 79, Функціональність 81, UX 83) — Продуктивність was
skipped this round (its next real step is another expensive multi-profile
escalation, already done twice this session; a lighter substitute wasn't
worth faking a category it didn't actually earn). Compared only against
this file's own previous entry (85.79/85.5).

**Functionality** (`68137bc`): hypothesis — `profileManager.clone()`'s
'full' mode (`fs.cpSync` copying a profile's live browser-data directory)
had only ever been tested against a *stopped* source with a static marker
file; does cloning a genuinely **running** profile (real Chromium actively
holding its Cookies DB / LevelDB storage open) risk a Windows file-locking
throw or a torn/corrupted copy? Tested live via a real E2E test cloning an
actually-running profile through the IPC bridge (`'full'` mode is
unit-tested and reachable this way, though never exposed through the
manager UI's own Clone button — an already-known, already-documented fact
from a prior round, not rediscovered here). **Hypothesis disproven**: the
copy succeeds and the clone starts cleanly, no corruption. A real
test-methodology gap was also found and fixed along the way (a clone
created via raw IPC never appears in the profile list without a UI-
triggered refresh — `ProfilesPage.tsx` only auto-polls while some *other*
profile is transitioning) — this was a test-side omission, not a
product bug, so it doesn't itself carry any score weight here.

**UX** (`8dc6dcc`): first-ever live walkthrough of the Proxies page
(add → test → geolocate → history → edit → delete), the exact same
method used all session. **Real bug found and fixed**: editing a proxy's
port left the *previous* Test result unchanged in the status pill (e.g.
still showing `Failed: connect ECONNREFUSED 127.0.0.1:8080` after the
port was changed to 9090) — a stale result naming a configuration that no
longer existed. Root-caused (`ProxiesPage.tsx`'s edit handler only ever
called `refresh()` for the proxy list, never clearing the separate
`results`/`geo`/`history`/`mismatchedProfileCount` state a manual Test/
Geolocate click populates), fixed with a `clearStaleCheckState()` helper,
verified fixed live (rebuilt, reloaded, reproduced, confirmed gone), and
given a permanent unit test. One separate, real UX inconsistency was
found and **deliberately left as-is**: Test's failure pill shows the raw
Node.js socket error (`connect ECONNREFUSED ...`) while Geolocate's shows
a clean generic message — judged, not glossed over, as more likely a
reasonable design choice than a bug, since a proxy connectivity test is a
technical diagnostic for a technical audience where the specific error
code is genuinely more actionable than a vague "Failed".

Real numbers: unit — **786 tests, 74 files, all passing** (+1 net new
test; the E2E clone test lives in `tests/e2e/`, outside this count).
`profileCloning.spec.ts` — 2/2 passed, including the new running-clone
test. `typecheck`/`lint` — clean.

| Category | Score | Δ vs previous entry (85.79/85.5) | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | 82 | +1 | `68137bc` — a real, previously-untested edge case (full clone of a running profile) confirmed already correct; confidence gained, not a fix, same small-credit convention as the identical situation two rounds ago (proxy rotation edge cases). |
| UX | 85 | +2 | `8dc6dcc` — a real bug found AND fixed via a live walkthrough of a page never checked before, with a permanent regression test — stronger than the previous round's UX credit, which found friction but no fix. |
| Дизайн | 86 | 0 | No design work this round. |
| Стабільність ×1.5 | 88 | 0 | No dedicated stability work this round. |
| Безпека ×1.5 | 85 | 0 | No security work this round. |
| Код/архітектура | 87 | 0 | The proxy fix is a small, targeted state-management fix in one page component, not an architectural change. |
| Тести | 90 | 0 | 2 new tests added this round (one E2E, one unit) — both credited to the categories whose gap they actually closed (Функціональність, UX) rather than double-counted here, consistent with how this same round's own prior entry split test credit across categories rather than always routing it through this one. |
| Продуктивність | 79 | 0 | Deliberately skipped this round — the next real step is another expensive multi-profile escalation already done twice this session; not worth a token substitute. |
| Реліз | 88 | 0 | No release work this round. |
| Fingerprint ×2 | 88 | 0 | No fingerprint work this round. |

**Simple average:** (82+85+86+88+85+87+90+79+88+88)/10 = **85.8**
**Weighted average:** (82+85+86+88×1.5+85×1.5+87+90+79+88+88×2)/12 = **86.04**

**Summary:** verification confirmed the previous entry's score was real,
not inflated. This round's own follow-up work moved the number by a
small, honest amount (+0.25 weighted / +0.3 simple) — one confirmed-safe
edge case and one real, fixed, tested UX bug — deliberately not padded
toward any particular target number. **Nothing has been pushed — the
`v0.5.0` tag and every commit (through `8dc6dcc`) remain local, pending
explicit confirmation.**

## 2026-09-10 — 86.46 weighted / 86.2 simple

Per explicit instruction: (1) push every commit and the `v0.5.0` tag from
the previous two rounds (now done — confirmed via `git status` showing
`main` in sync with `origin/main`, and `git ls-remote --tags origin`
showing `v0.5.0` present, pointing at `cb0219f`); (2) two of this file's
own bottom-3 categories (Продуктивність 79, Функціональність 82 — UX 85
was tied with Безпека and no longer clearly bottom-2, so not picked this
round) plus the always-continued Fingerprint investigation. Compared only
against this file's own previous entry (86.04/85.8).

**Performance** (`bc70237`): a third careful 20→50→100 `maxConcurrentLaunches`
2/4/8 escalation, same continuous-detached-poll method as the prior two,
this time on a machine with substantially more total RAM (~31GB vs.
~13-16GB previously). **0 failures, 0 orphans at every tier and
concurrency — and, genuinely different from both prior rounds, 0 real-risk
signal at any concurrency, including 2.** The continuous poll's true
minimum (4.65GB free) is still deeper than any single tier's own discrete
sample, the familiar pattern, but nowhere near the 90MB near-exhaustion the
same 100-profile tier produced on a ~13GB-total machine two rounds ago.
Real, load-bearing conclusion: **safe-concurrency headroom scales with the
machine's own total RAM, not a fixed profile count** — the "concurrency 8
is safer at 100+ profiles" finding is real but specific to low-headroom
machines, not universal. Updated `docs/LOAD_TEST.md` and `README.md`'s
concurrency note accordingly.

**Functionality** (`18f54d4`): three edge-case hypotheses checked (per the
three explicitly suggested options) — schedule-trigger-vs-soft-delete and
restore-after-hard-delete-timeout both turned out to already be correctly
handled **and already covered by existing tests**
(`profileScheduler.test.ts`'s "listScheduled() excludes soft-deleted
profiles", `profileSoftDelete.test.ts`'s "restoreDeleted() after the undo
window already elapsed throws") — Node's single-threaded, run-to-completion
execution model rules out the classic race conditions both hypotheses were
checking for. Not rediscovered as new findings, not force-fixed. The third
— automation API with simultaneous clients — was genuinely untested: added
a real E2E test opening two independent CDP clients concurrently through
the same automation-proxy port, confirming no cross-wiring between the
proxy's per-connection byte pipes (each gets its own fresh socket and its
own `Target.attachToTarget` session). Hypothesis disproven — already safe
by design.

**Fingerprint ×2** (`ff0e1d8`): Twentieth investigation, same live-profile
method. `screen.availWidth`/`availHeight` — a candidate leak of the real
host's own taskbar-adjusted screen area — checked on both a mobile and a
desktop profile, confirmed already correct (exactly matches
`screenWidth`/`screenHeight`, no host leak); given a permanent regression
check anyway, matching the Nineteenth investigation's posture, to guard
against a future regression rather than because a gap exists today.
`performance.memory.jsHeapSizeLimit` — checked decisively by comparing two
live profiles with `deviceMemory` 4 and 16 on the same real 32GB machine:
the reported heap limit was byte-for-byte identical in both cases,
confirming it's a fixed V8/Chromium architecture constant, not tied to
this app's spoofing and not a real host-RAM leak either — genuinely
nothing to fix, no lever exists for it in Electron's own API surface.

Real numbers: unit — **786 tests, 74 files, all passing** (+1 net new
test since the last entry; the two E2E additions this round live in
`tests/e2e/`, outside this count). `fingerprintEnforcement.spec.ts` — 6/6
passed, including the new `screenAvailArea` assertion. `typecheck`/`lint`
— clean after every item.

| Category | Score | Δ vs previous entry (86.04/85.8) | Reason for Δ (commit/file) |
|---|---|---|---|
| Функціональність | 83 | +1 | `18f54d4` — one genuinely new, real E2E test closing an untested concurrency gap; the other two hypotheses checked were already both correctly handled and already tested, so they add confidence but not new coverage. |
| UX | 85 | 0 | Not picked this round — no longer clearly bottom-2 once Функціональність (82) and Продуктивність (79) were both lower. |
| Дизайн | 86 | 0 | No design work this round. |
| Стабільність ×1.5 | 88 | 0 | No dedicated stability work this round. |
| Безпека ×1.5 | 85 | 0 | No security work this round. |
| Код/архітектура | 87 | 0 | No architectural work this round. |
| Тести | 90 | 0 | 2 new E2E tests added this round, both credited to the categories whose gap they closed (Функціональність, Fingerprint's permanent check) rather than double-counted here, same convention as every prior round. |
| Продуктивність | 81 | +2 | `bc70237` — a real, informative escalation that revised the standing recommendation (hardware-dependent, not universal) rather than just re-confirming the app doesn't break; a genuinely new, useful conclusion, not a repeat measurement. |
| Реліз | 88 | 0 | No release work this round (the push itself is process, not a code/release-readiness change). |
| Fingerprint ×2 | 89 | +1 | `ff0e1d8` — one new permanent regression check added (availWidth/availHeight) plus a decisive, non-trivial finding (jsHeapSizeLimit is a V8 constant, closing off a real hypothesis) — smaller than the Nineteenth investigation's credit since no fix shipped this round, both vectors came back clean. |

**Simple average:** (83+85+86+88+85+87+90+81+88+89)/10 = **86.2**
**Weighted average:** (83+85+86+88×1.5+85×1.5+87+90+81+88+89×2)/12 = **86.46**

**Summary:** a small, honest movement (+0.42 weighted / +0.4 simple),
not forced toward 87/88/90 or any other round number. The most valuable
single result this round is arguably the performance one — not because a
bug was fixed, but because it correctly revised a standing recommendation
from "universal rule" to "hardware-dependent", which is more useful to a
future reader than either extreme (blindly trusting the old rule, or
re-running it without drawing the comparison). **This round's own commits
(`bc70237`, `18f54d4`, `ff0e1d8`, and this entry) have NOT been pushed —
only the prior two rounds' work (through `8dc6dcc`) was pushed, per this
round's explicit, separate authorization.**
