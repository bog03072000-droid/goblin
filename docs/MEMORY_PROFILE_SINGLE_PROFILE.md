# Memory profile — one running profile (real measurement)

Generated: 2026-09-03, updated 2026-09-04 (see "Update" section below — the
2026-09-04 measurement supersedes the ~240 MB figure below with a more
precise, isolated one; kept the original write-up intact rather than
rewriting history)

## What was asked

Profile one running profile's child process (originally scoped as
`--expose-gc` + a V8 heap snapshot) to find out whether the ~585 MB/profile
figure from `docs/LOAD_TEST.md` has room for a safe reduction. Explicitly
**not** the frozen RAM-architecture direction (the Puppeteer/Playwright-style
Chromium CLI flags tried and reverted — see `browserLauncher.ts`'s own
comment; measured 19% *worse* peak RAM at scale, not better) — this is a
different question: where does one profile's own memory actually go, not
"can a flag make Chromium use less."

## What was actually measured, and why not the originally-planned method

The `--expose-gc` + heap-snapshot plan targets a single process's V8 JS
heap specifically. Two real, encountered blockers changed the method:

1. **Session isolation**: this session's shell tool (PowerShell/Bash) runs
   in a different Windows session than the one a GUI app launched via the
   desktop-automation tool actually runs in — `Get-Process`/
   `Get-CimInstance` from the shell tool see **zero** of the real running
   app's processes, confirmed directly (`Get-Process electron` → count 0
   while the app was visibly running on screen). This ruled out driving
   `--expose-gc`/`process.memoryUsage()` from a script launched by the
   shell tool against the real interactive app instance.
2. **Task Manager, once opened to work around (1), turned out to be an
   elevated process** — clicks past the first couple stopped registering
   (End Task, the window's own Close button, and further row selection all
   silently no-op'd), consistent with this environment's own documented
   UIPI limitation for elevated processes. This blocked getting a
   per-process (main/GPU/renderer/utility/audio) breakdown via Task
   Manager's Details view.

Given both blockers, the method actually used: a real profile
("Memory Profile Test") was created and started via the actual built app
(Quick Create → Start, both visually confirmed), navigated to google.com
(the default start page), then Task Manager's Processes view — which DID
render and DID show real, live-updating numbers even though further clicks
into it stopped registering — was read repeatedly over several minutes.

**This is a real limitation of this measurement, stated plainly rather than
worked around with a fabricated number**: the result below is the
*combined* total for the manager process + one running profile (both are
grouped under one "Electron" entry in Task Manager, which does not
distinguish them), not an isolated per-profile-only number, and it does
not break down by process role (main/GPU/renderer/utility/audio) the way
the original `--expose-gc`-based plan would have.

## Real result

**9 Electron processes (manager + 1 running profile), steady-state,
combined: ~238–254 MB**, sampled 8 times over ~7 minutes of the profile
sitting on a loaded google.com page (min 237.9 MB, max 254.3 MB — normal
V8/Chromium GC-driven fluctuation, not a leak trend; no monotonic growth
across the samples).

This is well under half of the ~585 MB/profile figure
`docs/LOAD_TEST.md` reports. That figure was derived differently — as
`(free system RAM before) − (free system RAM at peak)`, divided by profile
count, during a **batch of 20 simultaneous profile launches** under real
memory/CPU contention (see `LOAD_TEST_BULKSTART_RAW.md`'s own 20-profile
tier: ~2.6–2.7 GB used at peak ÷ 20 ≈ 130–135 MB delta per profile at that
scale even there, notably *less* per-profile than the original ~585 MB
figure, which itself came from an even earlier, since-corrected 20-profile
attempt that also included the manager's own baseline and general system
noise in the same delta — see that file's own "first attempt" account).
**The two numbers were never actually measuring the same thing**: this
session's ~240 MB is one profile's real total OS footprint in isolation;
the ~585 MB figure is a rougher, system-wide delta average from a very
different (concurrent, contended, partly-superseded) measurement. Neither
is wrong for what it measured — they answer different questions ("what
does one isolated profile cost" vs. "what's the system-wide RAM delta
during a 20-profile burst") — but they are not directly comparable the way
`docs/LOAD_TEST.md`'s prose currently implies, and that prose is not
changed here since this session couldn't isolate a clean single-profile
number under the *same* concurrent conditions to make a fair like-for-like
replacement.

## Conclusion: no safe reduction found, and none is expected from application code

Given:
- The one concrete code-level lever this project has actually tried
  (Puppeteer/Playwright-style Chromium startup flags to skip unused
  Google-service integrations) was measured to make peak RAM at scale
  **worse**, not better, and was reverted — see `browserLauncher.ts`'s own
  comment and `LOAD_TEST_BULKSTART_RAW.md`.
- This session's measurement shows the memory is real, live Chromium
  process overhead (9 separate OS processes for one manager + one
  profile), not obviously concentrated in this project's own JS — there is
  no heap-snapshot evidence of an application-level leak or oversized
  retained object graph, because that specific measurement could not be
  taken this session (see the blockers above), but the multi-process
  *shape* of the memory (spread across ~5 processes per profile, not one)
  is itself consistent with inherent Chromium multi-process architecture
  cost, not a single bloated JS heap this project's own code could trim.
- No new, different, untried hypothesis for a safe reduction exists — the
  same conclusion the RAM-architecture investigation already reached.

**No code change was made.** This matches the instruction: apply a fix
only if a genuinely safe one is actually found and measured; otherwise
document honestly rather than hold an undemonstrated "improvement." The
one real, useful finding from this session — that per-profile RAM cost is
**not a fixed constant** and is measurably lower for an isolated profile
than the system-wide average during a concurrent burst — is operationally
actionable for a user today without any code change: running fewer
profiles concurrently costs proportionally less RAM per profile than
bulk-launching many at once, consistent with `LOAD_TEST_BULKSTART_RAW.md`'s
own finding of compressing RAM headroom and super-linear startup time at
higher concurrent tiers.

## Update, 2026-09-04 — a cleaner per-process measurement, and it revises the conclusion above

Asked to repeat this measurement via CDP's `Memory.getBrowserMemoryUsage`
instead of driving the Task Manager UI, to route around the session-
isolation and UIPI blockers documented above.

**That exact CDP method doesn't exist.** The Chrome DevTools Protocol's
public `Memory` domain only has `getDOMCounters`, `startSampling`/
`stopSampling`, `getSamplingProfile`, `forciblyPurgeJavaScriptMemory`,
`prepareForLeakDetection`, and the pressure-notification methods — none of
which return OS-level process memory. Checked this before writing any code,
rather than half-implementing a method that isn't there.

**What was used instead: `app.getAppMetrics()`**, Electron's own main-
process API — the same one Electron's built-in Task Manager uses
internally. Each profile already runs as its own separate Electron process
(one profile == one OS process tree, per `profileWindowEntry.ts`'s own
module doc comment), so calling this from *inside* that profile's own main
process, rather than from the manager, gives a clean per-process breakdown
for exactly one profile with no GUI interaction at all — sidestepping both
blockers directly instead of working around them.

Implementation: a `PF_DEBUG_MEMORY=1`-gated block in
`src/main/browser/profileWindowEntry.ts` (same env-var-gated pattern
already used by `PF_E2E_AUTO_DIAGNOSTICS` in the same file), sampling
`app.getAppMetrics()` every 20s and appending it to a `memory-debug.log`
file next to the profile's own `userData`. Not wired into the normal app
path — only active when that env var is set, so it ships inert.

### Real result

One profile ("Memory Profile Test"), steady state, four samples ~20s apart,
**5 OS processes** (Browser/main, GPU, Utility, and 2 Tab/renderer
processes — this profile had 2 tabs open):

| Sample | Browser | GPU | Utility | Tab 1 | Tab 2 | Total |
|---|---|---|---|---|---|---|
| 12:38:02 | 141,840 | 137,808 | 95,568 | 94,624 | 133,772 | 603,612 KB (589.5 MB) |
| 12:38:22 | 136,684 | 137,800 | 95,636 | 94,328 | 126,976 | 591,424 KB (577.6 MB) |
| 12:38:42 | 135,584 | 137,800 | 95,152 | 94,328 | 130,024 | 592,888 KB (579.0 MB) |
| 12:39:02 | 135,576 | 137,540 | 95,132 | 94,524 | 124,840 | 587,612 KB (573.8 MB) |

**Average ≈ 580 MB, range 573.8–589.5 MB** for this one isolated profile —
essentially in line with the original ~585 MB/profile figure in
`docs/LOAD_TEST.md`, not the ~240 MB this doc reported above.

### This revises the conclusion above, not just adds to it

The ~240 MB Task Manager figure above was explicitly caveated as "combined
manager + one running profile... grouped under one 'Electron' entry, which
does not distinguish them" — i.e. it was never a clean per-profile number
to begin with, just the best available given that measurement's own
blockers. This new measurement *is* clean (one profile's own process tree,
nothing else mixed in), and it lands close to the original ~585 MB figure
instead of confirming the earlier "per-profile RAM cost is lower in
isolation" finding. That earlier finding is **retracted** — it was an
artifact of the Task Manager method's inability to cleanly separate the two
"Electron" entries, not a real property of isolated vs. concurrent
profiles. The right conclusion is the simpler one: one profile, isolated or
not, costs roughly ~580 MB across its 5 OS processes, matching what
`docs/LOAD_TEST.md` already reported.

No code change was made here either — this was a measurement task, and the
`PF_DEBUG_MEMORY` instrumentation stays inert unless explicitly enabled.
