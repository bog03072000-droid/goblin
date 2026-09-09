# Load test — profile isolation (raw data)

Generated: 2026-09-09T14:33:13.642Z

Profiles tested: 20 across 2 tiers of 10+10 (real, sequential within each tier, one real browser running at a time; each tier its own fresh app instance)
Overall result: PASS — no profile ever saw another profile’s cookie, localStorage, or IndexedDB data
Average real browser start time: 55ms

| Profile # | Cookie clean on start | localStorage clean on start | IndexedDB clean on start | Start time (ms) |
|---|---|---|---|---|
| 0 | yes | yes | yes | 69 |
| 1 | yes | yes | yes | 57 |
| 2 | yes | yes | yes | 60 |
| 3 | yes | yes | yes | 57 |
| 4 | yes | yes | yes | 63 |
| 5 | yes | yes | yes | 51 |
| 6 | yes | yes | yes | 51 |
| 7 | yes | yes | yes | 51 |
| 8 | yes | yes | yes | 51 |
| 9 | yes | yes | yes | 50 |
| 10 | yes | yes | yes | 50 |
| 11 | yes | yes | yes | 51 |
| 12 | yes | yes | yes | 51 |
| 13 | yes | yes | yes | 59 |
| 14 | yes | yes | yes | 59 |
| 15 | yes | yes | yes | 51 |
| 16 | yes | yes | yes | 53 |
| 17 | yes | yes | yes | 54 |
| 18 | yes | yes | yes | 54 |
| 19 | yes | yes | yes | 52 |

_Real measured numbers from this machine/run — not fabricated._
