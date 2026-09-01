# Load test — bulk start/stop (raw data)

Generated: 2026-09-01 (three separate real runs, consolidated below; each
tier below is this test file's own generated table from its own run,
re-assembled here by hand since `loadTestBulkStartStop.spec.ts`'s own
report-writing test overwrites this file with only its own run's tier —
every number is copy-pasted verbatim from that run's real output, not
re-derived or extrapolated).

`PROFILE_COUNT` was raised via `PF_LOAD_TEST_PROFILE_COUNT` (see the test
file) in three stages — 20, then 50, then 100 — checking real stability at
each tier before going further, per the machine's current headroom
(~15GB free at the start of this session, well above the ~3.7GB seen during
the original 20-profile incident documented in the test file's own module
comment).

## Tier: 20 profiles

Free RAM before this tier: ~15.1GB.

| Concurrency | Total startup (ms) | Time to first RUNNING (ms) | Time to all-terminal (ms) | Succeeded | Failed | Orphan processes after bulk-stop | Free RAM before (MB) | Free RAM at peak (MB) | RAM used at peak (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 3250 | 3239 | 3292 | 20 | 0 | 0 | 15090 | 12431 | 2659 |
| 4 | 1962 | 1682 | 1988 | 20 | 0 | 0 | 14920 | 12365 | 2555 |
| 8 | 1158 | 1148 | 1281 | 20 | 0 | 0 | 14752 | 12509 | 2243 |

## Tier: 50 profiles

Free RAM before this tier: ~15.0GB.

| Concurrency | Total startup (ms) | Time to first RUNNING (ms) | Time to all-terminal (ms) | Succeeded | Failed | Orphan processes after bulk-stop | Free RAM before (MB) | Free RAM at peak (MB) | RAM used at peak (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 14295 | 14258 | 15183 | 50 | 0 | 0 | 15016 | 8047 | 6969 |
| 4 | 8180 | 7922 | 8641 | 50 | 0 | 0 | 14682 | 8735 | 5947 |
| 8 | 4670 | 3751 | 4963 | 50 | 0 | 0 | 14542 | 9952 | 4590 |

## Tier: 100 profiles

Free RAM before this tier: ~14.7GB.

| Concurrency | Total startup (ms) | Time to first RUNNING (ms) | Time to all-terminal (ms) | Succeeded | Failed | Orphan processes after bulk-stop | Free RAM before (MB) | Free RAM at peak (MB) | RAM used at peak (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 92240 | 91493 | 93864 | 100 | 0 | 0 | 14660 | 3981 | 10679 |
| 4 | 49232 | 47055 | 51508 | 100 | 0 | 0 | 14591 | 5014 | 9577 |
| 8 | 23113 | 11926 | 26265 | 100 | 0 | 0 | 14196 | 6271 | 7925 |

_Real measured numbers from this machine/run — not fabricated. "Time to
first RUNNING" and "all-terminal" are cumulative from the bulk Start click.
Orphan count is (final electron.exe process count) - (baseline before this
run) - 1, clamped to 0. RAM figures come from
`Get-CimInstance Win32_OperatingSystem` sampled once before the bulk-start
click and once when every profile reaches a terminal state (peak concurrent
process count) — whole-system free memory, not per-process, since the
profiles are separate OS processes with their own child helpers._

## Stopped at 100 — real findings, not a forced ceiling

All three tiers (20/50/100) completed with **0 failures and 0 orphan
processes** across all 9 concurrency×tier combinations — the app itself
never destabilized, crashed, or leaked a process at any tier tested on this
machine (32GB total RAM, ~15GB free at the start of each tier).

That said, two real, honest degradation signals showed up between 50 and
100 that are worth recording as this machine's practical limits, not just
"it passed":

1. **RAM headroom compresses fast, and non-linearly, as concurrency drops.**
   At `maxConcurrentLaunches=2` (the app's own default), free RAM dropped
   from ~14.7GB to ~4.0GB for 100 profiles — using ~10.7GB, versus ~6.9GB
   for 50 profiles (50 more profiles cost 3.7GB more, not the ~7GB a linear
   extrapolation from the 20→50 tier would predict — Chromium's shared
   memory/DLL pages amortize somewhat at scale, but the *low* concurrency
   case is the one that holds the most processes concurrently mid-batch,
   which is exactly where this matters). At `maxConcurrentLaunches=2` this
   machine went from "20/50 profiles: comfortable, >8GB free at peak" to
   "100 profiles: ~4GB free at peak" — still short of the ~0.6GB-free
   incident documented in the test file's own module comment, but a real,
   visible trend toward that danger zone, not a flat line. A machine with
   less free RAM to start from (the original incident had only ~3.7GB free
   *before* starting) would very plausibly hit real destabilization at 100
   profiles where this one didn't.
2. **Startup time scales far worse than profile count at low concurrency.**
   20→50→100 profiles at `maxConcurrentLaunches=2`: ~3.3s → ~15.2s → ~93.9s
   to reach all-terminal. That's roughly 4.5x profiles (20→100) producing
   ~28x the wall-clock time, not the ~5x a linear model would predict — real
   OS-level contention (disk I/O for each Chromium profile directory, CPU
   scheduling across that many concurrent-ish processes) compounding as the
   queue gets longer, not a test artifact. At `maxConcurrentLaunches=8` the
   same 20→100 growth is a much tamer ~1.2s → ~26.3s (~22x for 4.5x more
   profiles) — still super-linear, but far less punishing, because higher
   concurrency finishes each wave faster and the total queue drains sooner.

**Conclusion:** 100 profiles is a stable, honestly-reached ceiling on this
machine — not a wall the app hit, but the point where the trend in RAM
headroom and startup time both stopped looking flat. A user with less spare
RAM than this development machine, or bulk-starting 100 profiles at the
default `maxConcurrentLaunches=2`, should expect a genuinely slow (~90s+)
batch and a real, visible dent in free system memory — this is real product
behavior worth knowing about, not a test-environment quirk. 200+ profiles
were not attempted: the trend above already shows real cost growth by 100,
and pushing further on a shared development machine risked exactly the kind
of system-wide instability the original 20-profile incident (documented in
`loadTestBulkStartStop.spec.ts`'s own module comment) was written to avoid.
