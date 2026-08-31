# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-08-31T07:44:48.644Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 45 |
| search (200 -> 1 row) | 407 |
| tag filter (even5) | 135 |
| group filter (Load UI Group A) | 198 |
| select-all (200 rows) | 227 |
| invert selection (200 -> 0) | 154 |
| bulk add-tag (200 profiles) | 1952 |
| sort direction toggle (200 rows) | 426 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
