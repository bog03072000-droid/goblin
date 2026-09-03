# Load test — profile isolation (raw data)

Generated: 2026-09-03T11:03:43.530Z

Profiles tested: 20 across 2 tiers of 10+10 (real, sequential within each tier, one real browser running at a time; each tier its own fresh app instance)
Overall result: PASS — no profile ever saw another profile’s cookie, localStorage, or IndexedDB data
Average real browser start time: 50ms

| Profile # | Cookie clean on start | localStorage clean on start | IndexedDB clean on start | Start time (ms) |
|---|---|---|---|---|
| 0 | yes | yes | yes | 57 |
| 1 | yes | yes | yes | 51 |
| 2 | yes | yes | yes | 51 |
| 3 | yes | yes | yes | 52 |
| 4 | yes | yes | yes | 56 |
| 5 | yes | yes | yes | 50 |
| 6 | yes | yes | yes | 47 |
| 7 | yes | yes | yes | 47 |
| 8 | yes | yes | yes | 49 |
| 9 | yes | yes | yes | 44 |
| 10 | yes | yes | yes | 64 |
| 11 | yes | yes | yes | 50 |
| 12 | yes | yes | yes | 50 |
| 13 | yes | yes | yes | 49 |
| 14 | yes | yes | yes | 50 |
| 15 | yes | yes | yes | 41 |
| 16 | yes | yes | yes | 50 |
| 17 | yes | yes | yes | 48 |
| 18 | yes | yes | yes | 51 |
| 19 | yes | yes | yes | 49 |

_Real measured numbers from this machine/run — not fabricated._
