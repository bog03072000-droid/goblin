# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T13:24:37.392Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 170 |
| search (200 -> 1 row) | 654 |
| tag filter (even5) | 195 |
| group filter (Load UI Group A) | 347 |
| select-all (200 rows) | 377 |
| invert selection (200 -> 0) | 286 |
| bulk add-tag (200 profiles) | 1650 |
| sort direction toggle (200 rows) | 502 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
