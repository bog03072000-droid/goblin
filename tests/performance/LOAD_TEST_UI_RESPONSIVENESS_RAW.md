# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T13:49:58.500Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 279 |
| search (200 -> 1 row) | 469 |
| tag filter (even5) | 149 |
| group filter (Load UI Group A) | 208 |
| select-all (200 rows) | 250 |
| invert selection (200 -> 0) | 275 |
| bulk add-tag (200 profiles) | 1679 |
| sort direction toggle (200 rows) | 324 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
