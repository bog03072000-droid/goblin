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
