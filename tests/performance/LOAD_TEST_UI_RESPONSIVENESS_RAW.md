# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T12:56:15.395Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 89 |
| search (200 -> 1 row) | 740 |
| tag filter (even5) | 159 |
| group filter (Load UI Group A) | 352 |
| select-all (200 rows) | 418 |
| invert selection (200 -> 0) | 287 |
| bulk add-tag (200 profiles) | 424 |
| sort direction toggle (200 rows) | 491 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
