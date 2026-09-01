# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T11:57:35.985Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 339 |
| search (200 -> 1 row) | 409 |
| tag filter (even5) | 159 |
| group filter (Load UI Group A) | 162 |
| select-all (200 rows) | 301 |
| invert selection (200 -> 0) | 294 |
| bulk add-tag (200 profiles) | 403 |
| sort direction toggle (200 rows) | 504 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
