# Load test — stability, real per-cycle CDP navigation (isolated investigation)

Generated: 2026-09-04T14:12:44.532Z

Profile: "CDP Nav Stability Profile", 10 cycles/repeat, 8 repeats, real navigation via the shell's own address bar over a fresh CDP connection each cycle (not a JS-eval shortcut).

| Repeat | Cycles completed | Crashed at cycle |
|---|---|---|
| 1 | 10 | — (clean) |
| 2 | 10 | — (clean) |
| 3 | 10 | — (clean) |
| 4 | 10 | — (clean) |
| 5 | 10 | — (clean) |
| 6 | 10 | — (clean) |
| 7 | 10 | — (clean) |
| 8 | 10 | — (clean) |

Verdict: NOT reproduced across all repeats — see docs/LOAD_TEST.md Test 5 for the updated conclusion.

_Real measured numbers from this machine/run — not fabricated._
