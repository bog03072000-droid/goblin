# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T15:13:30.752Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 298 |
| search (200 -> 1 row) | 490 |
| tag filter (even5) | 75 |
| group filter (Load UI Group A) | 217 |
| select-all (200 rows) | 258 |
| invert selection (200 -> 0) | 282 |
| bulk add-tag (200 profiles) | 414 |
| sort direction toggle (200 rows) | 499 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
