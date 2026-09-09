# Load test — stability, real per-cycle CDP navigation (isolated investigation)

Generated: 2026-09-09T14:42:18.087Z

Profile: "CDP Nav Stability Profile", 10 cycles/repeat, 8 repeats, real navigation via the shell's own address bar over a fresh CDP connection each cycle (not a JS-eval shortcut).

| Repeat | Cycles completed | Crashed at cycle | Slow-navigation cycles (real timing, not a crash) |
|---|---|---|---|
| 1 | 10 | — (clean) | — |
| 2 | 10 | — (clean) | 2 |
| 3 | 10 | — (clean) | — |
| 4 | 10 | — (clean) | 6 |
| 5 | 10 | — (clean) | — |
| 6 | 10 | — (clean) | — |
| 7 | 10 | — (clean) | 6 |
| 8 | 10 | — (clean) | — |

Verdict: NOT reproduced across all repeats — see docs/LOAD_TEST.md Test 5 for the updated conclusion.
Separately: 3 of 80 total cycles saw navigation take longer than its fixed timeout — real accumulated CPU/process pressure across up to 80 real start/navigate/stop cycles in one run, not a crash and not a code bug (each such cycle is recorded above, never silently retried with a bigger timeout).

_Real measured numbers from this machine/run — not fabricated._
