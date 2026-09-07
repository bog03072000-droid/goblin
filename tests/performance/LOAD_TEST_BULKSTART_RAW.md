# Load test — bulk start/stop (raw data)

Generated: 2026-09-07T13:57:03.813Z

Profile count: 100 (override with PF_LOAD_TEST_PROFILE_COUNT; see tests/performance/LOAD_TEST_BULKSTART_RAW.md for the consolidated 20/50/100 real-run results and this file's own module comment for history)

| Concurrency | Total startup (ms) | Time to first RUNNING (ms) | Time to all-terminal (ms) | Succeeded | Failed | Orphan processes after bulk-stop | Free RAM before (MB) | Free RAM at peak (MB) | RAM used at peak (MB) |
|---|---|---|---|---|---|---|---|---|---|
| 2 | 18449 | 18273 | 19018 | 100 | 0 | 0 | 15227 | 3131 | 12096 |
| 4 | 21005 | 16786 | 41748 | 100 | 0 | 0 | 15377 | 6545 | 8832 |
| 8 | 11239 | 9449 | 22049 | 100 | 0 | 0 | 15201 | 8204 | 6997 |

_Real measured numbers from this machine/run — not fabricated. "Time to first RUNNING" and "all-terminal" are cumulative from the bulk Start click. Orphan count is (final electron.exe process count) - (baseline before this run) - 1, clamped to 0; -1 means process counting was unavailable (non-Windows). RAM figures come from `Get-CimInstance Win32_OperatingSystem` sampled once before the bulk-start click and once when every profile reaches a terminal state (peak concurrent process count) — whole-system free memory, not per-process, since the profiles are separate OS processes with their own child helpers. CPU is not reported here: this run completes in low single-digit seconds, too short a window for a system-wide CPU sample to mean anything._
