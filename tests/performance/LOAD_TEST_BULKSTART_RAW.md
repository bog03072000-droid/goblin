# Load test — bulk start/stop (raw data)

Generated: 2026-09-01T12:54:37.470Z

Profile count: 10 (see this file's own module comment for why 50/100 real-simultaneous-browser tiers were not run in this environment)

| Concurrency | Total startup (ms) | Time to first RUNNING (ms) | Time to all-terminal (ms) | Succeeded | Failed | Orphan processes after bulk-stop | Free RAM before (MB) | Free RAM at peak (MB) | RAM used at peak (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 1621 | 1551 | 1635 | 10 | 0 | 0 | 18903 | 17479 | 1424 |
| 4 | 1083 | 1077 | 1400 | 10 | 0 | 0 | 18733 | 17189 | 1544 |
| 8 | 492 | 484 | 524 | 10 | 0 | 0 | 18642 | 17335 | 1307 |

_Real measured numbers from this machine/run — not fabricated. "Time to first RUNNING" and "all-terminal" are cumulative from the bulk Start click. Orphan count is (final electron.exe process count) - (baseline before this run) - 1, clamped to 0; -1 means process counting was unavailable (non-Windows). RAM figures come from `Get-CimInstance Win32_OperatingSystem` sampled once before the bulk-start click and once when every profile reaches a terminal state (peak concurrent process count) — whole-system free memory, not per-process, since the profiles are separate OS processes with their own child helpers. CPU is not reported here: this run completes in low single-digit seconds, too short a window for a system-wide CPU sample to mean anything._
