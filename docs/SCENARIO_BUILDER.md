# No-code Scenario Builder — MVP

A minimal, real recorder/player for repeated browser actions: record real
clicks, typed-and-committed text, and page navigation on a profile's current
tab, save the sequence as a named scenario, and replay it later — against
the same profile or a different one. This document explains what the MVP
actually does, how it works end to end, and — just as importantly — what it
deliberately does *not* do yet, per this project's standing rule of never
silently overclaiming coverage.

## Why this exists

Every other automation feature in this app (`humanClick`/`humanType`/
`humanScroll`, the "Test human input" button, the Warm-up/Cookie-Robot
feature) requires writing a script — either a real Puppeteer/Playwright
script against the automation API, or main-process TypeScript. The
Scenario Builder is the one no-code path: click "Record", do the thing
once by hand, click "Stop", save it, and "Play" reproduces it later without
writing anything.

## Architecture

```
Record:  in-page listener (click/change) ──┐
         did-navigate (main process)   ─────┤──► merge by timestamp ──► ScenarioStep[]
                                            │        (scenarioRecording.ts)
Save:    ScenarioStep[] ──► scenarios table (SQLite, per-app-instance DB)

Play:    ScenarioStep[] ──► humanClick / humanType / webContents.loadURL
                             (scenarioPlayer.ts — same primitives every
                              other automation feature already uses)
```

**Recording** (`src/shared/automation/scenarioRecorderScript.ts`,
`src/main/automation/scenarioRecording.ts`): an in-page script, injected via
`webContents.executeJavaScript()` (the same mechanism the "Test human
input" button already uses), attaches two `document`-level listeners:

- `click` (capture phase) — records `{ x: e.clientX, y: e.clientY, t: Date.now() }`.
- `change` (capture phase, **not** `input`) — records the field's committed
  value. `change` fires once, when a field is blurred or committed (Enter
  for most inputs), giving exactly one action per field per interaction
  instead of one per keystroke (which `input` would produce — recording
  "h", "he", "hel", ... and replaying that as a stutter).

Navigation can't be observed from inside the page (a real navigation
destroys that page's own JS state), so it's tracked separately in the main
process via a `did-navigate` listener on the same `WebContents`. Stopping
recording reads the in-page array back out, merges it with the observed
navigation events by their real timestamp (`t`), and converts absolute
timestamps into `delayMs` — the gap from the previous step, used to pace
playback.

**Storage** (`src/main/database/scenarioRepository.ts`,
`database/migrations/016_scenarios.sql`): a plain `scenarios` table
(`id`, `name`, `steps` as JSON text, timestamps) — not tied to any single
profile. A scenario recorded against one profile can be replayed against
any other running profile, the same "reusable script" model as a real
Puppeteer script. Each profile's own child process talks to this table
directly via its own `better-sqlite3` connection to the same on-disk file
(WAL mode already supports this — the same pattern
`profileWindowDownloads.ts`'s `recordDownload()` already uses), not routed
through the manager process.

**Playback** (`src/main/automation/scenarioPlayer.ts`): walks the step
list in order. Before each step, it sleeps `min(step.delayMs, 3000ms)` —
long recorded pauses are capped so a person thinking for 30 seconds while
recording doesn't make every future replay wait 30 seconds too; short
gaps (the normal case) pass through unchanged. `click` steps go through
`humanClick()` (a curved, eased mouse path, not a teleport), `type` steps
through `humanType()` (per-character timing), and `navigate` steps through
the same `loadWithTimeout()` the Warm-up feature's Cookie-Robot-style
orchestrator already uses. **Unlike Warm-up's URLs, a scenario's steps are
NOT independent of each other by design** — if a step fails (e.g. a click
whose recorded coordinates no longer match the current page layout), the
whole scenario stops rather than continuing into steps that assumed the
failed one succeeded (a typed value assumes the click before it actually
focused the right field).

## UI

A "Scenario" button in the per-profile browser's toolbar (next to "Warm up
profile") opens a panel with three parts: a Record/Stop toggle, a name
field + Save button (shown once something has been recorded), and a list
of saved scenarios each with Play/Delete buttons. Deliberately not a
visual step editor — no drag-and-drop, no per-step editing UI. This is the
literal MVP scope: record, list, play. See "What a fuller version would
need" below for what's missing to grow past that.

## Real, documented MVP limits — not oversights

- **Single-page recording only.** The in-page recorder script's own state
  (the listeners, the accumulated actions array) lives in that page's own
  JS realm and does not survive a real navigation. A recorded scenario CAN
  include a `navigate` step (tracked separately by the main process, see
  above) — but only clicks/typed text on the page the user was on *when
  recording started* are captured; interacting with a *second* page after
  a recorded navigation, mid-recording, will not be captured. Recording a
  multi-page flow today means: navigate first (manually, before starting
  the recorder, or record the navigate step itself and re-record
  afterward), not "record everything across an arbitrary number of page
  transitions in one continuous session."
- **`change`, not `input`, for typed text.** A text field that is typed
  into but never blurred/committed before recording stops will not have
  its value captured at all. This was a deliberate choice (see above) to
  avoid a keystroke-by-keystroke stutter on replay, not an omission — but
  it does mean "type into a field and immediately click Stop without
  tabbing away" loses that field's value.
- **Coordinate-based click replay, not element-based.** A recorded click
  step stores raw `(x, y)` viewport coordinates, not a CSS selector or any
  other reference to *which element* was clicked. Replay clicks at the
  same coordinates on whatever page is loaded at that point in the
  scenario — if the page's layout has changed since recording (a different
  screen size, a redesigned page, dynamic content that shifted things),
  the replayed click can land on the wrong element or nothing at all. A
  fuller version would need to record a real element reference (a CSS
  selector, an XPath, or an accessibility-tree path) and resolve it fresh
  at playback time, the way a real test framework's own recorder does.
- **No step editing.** A recorded scenario is exactly what was recorded —
  there's no UI to reorder, delete, or edit an individual step, or to
  adjust a step's `delayMs` after the fact. Re-recording from scratch is
  the only way to change a saved scenario today.
- **No conditionals, loops, or variables.** A scenario is a flat,
  unconditional sequence — no "if this element exists", no "repeat N
  times", no parameterized values (e.g. "type today's date" or "type a
  value passed in at play time"). Every real no-code automation tool this
  project's own research compared against (Dolphin Anty's Scenario
  Builder, for one) eventually needs at least basic branching/looping to
  be useful for anything beyond a strictly linear flow.
- **A step failing stops the whole scenario**, by design (see Playback
  above) — there's no "skip this step and continue" option, and no
  per-step retry.

## What a fuller version would need

This MVP proves the core mechanism works end to end (see
`tests/e2e/scenarioBuilder.spec.ts` — a real recorded click and typed value
genuinely replay against a real running profile, not a mock of any layer).
Turning it into what "Scenario Builder" tends to mean in a commercial
antidetect tool — the bar this project's own competitive research (see the
top-5-features research this feature came out of) measured against — would
need, roughly in order of how much new surface each adds:

1. **Element-based click targeting** (selector/XPath capture + resolution
   at playback) instead of raw coordinates — the single biggest reliability
   gap of the current MVP.
2. **A real step-list editor** (reorder, delete, edit individual steps,
   adjust timing) — the current UI is genuinely "record → list → play",
   nothing in between.
3. **Multi-page recording** that survives real navigation within one
   continuous recording session, not just a separately-tracked navigate
   step.
4. **Basic control flow** (conditionals on element presence, simple
   loops, at minimum a "repeat this scenario N times" option) and
   **parameterization** (a scenario that accepts input values at play
   time, rather than only ever replaying literal recorded text).
5. **Per-profile scenario scoping / sharing UI** — today every scenario is
   globally visible to every profile; a real product would likely want
   folders/tags or at least a way to mark a scenario as "for this profile
   only" versus reusable.

None of the above is started — this document exists so a future session
picking this up (or evaluating what's here) has an honest account of where
the line was actually drawn, not a vague "TODO: improve this."
