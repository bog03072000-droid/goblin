# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T20:03:14.479Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 373 |
| search (200 -> 1 row) | 381 |
| tag filter (even5) | 131 |
| group filter (Load UI Group A) | 168 |
| select-all (200 rows) | 219 |
| invert selection (200 -> 0) | 326 |
| bulk add-tag (200 profiles) | 2113 |
| sort direction toggle (200 rows) | 456 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
