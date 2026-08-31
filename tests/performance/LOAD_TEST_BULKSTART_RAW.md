# Load test — bulk start/stop (raw data)

Generated: 2026-08-31T07:39:45.112Z

Profile count: 2 (see this file's own module comment for why 50/100 real-simultaneous-browser tiers were not run in this environment)

| Concurrency | Total startup (ms) | Time to first RUNNING (ms) | Time to all-terminal (ms) | Succeeded | Failed | Orphan processes after bulk-stop |
|---|---|---|---|---|---|---|

_Real measured numbers from this machine/run — not fabricated. "Time to first RUNNING" and "all-terminal" are cumulative from the bulk Start click. Orphan count is (final electron.exe process count) - (baseline before this run) - 1, clamped to 0; -1 means process counting was unavailable (non-Windows)._
