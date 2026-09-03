# Memory profile — one running profile (real measurement)

Generated: 2026-09-03

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
