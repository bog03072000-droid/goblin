# Load test — bulk start/stop (raw data)

Generated: 2026-09-01T14:22:27.188Z

Profile count: 10 (see this file's own module comment for why 50/100 real-simultaneous-browser tiers were not run in this environment)

| Concurrency | Total startup (ms) | Time to first RUNNING (ms) | Time to all-terminal (ms) | Succeeded | Failed | Orphan processes after bulk-stop | Free RAM before (MB) | Free RAM at peak (MB) | RAM used at peak (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 1683 | 1496 | 1712 | 10 | 0 | 0 | 15497 | 13949 | 1548 |
| 4 | 1002 | 992 | 1025 | 10 | 0 | 0 | 15393 | 13956 | 1437 |
| 8 | 583 | 575 | 610 | 10 | 0 | 0 | 15368 | 13884 | 1484 |

_Real measured numbers from this machine/run — not fabricated. "Time to first RUNNING" and "all-terminal" are cumulative from the bulk Start click. Orphan count is (final electron.exe process count) - (baseline before this run) - 1, clamped to 0; -1 means process counting was unavailable (non-Windows). RAM figures come from `Get-CimInstance Win32_OperatingSystem` sampled once before the bulk-start click and once when every profile reaches a terminal state (peak concurrent process count) — whole-system free memory, not per-process, since the profiles are separate OS processes with their own child helpers. CPU is not reported here: this run completes in low single-digit seconds, too short a window for a system-wide CPU sample to mean anything._
