# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T14:23:54.818Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 295 |
| search (200 -> 1 row) | 485 |
| tag filter (even5) | 164 |
| group filter (Load UI Group A) | 206 |
| select-all (200 rows) | 247 |
| invert selection (200 -> 0) | 277 |
| bulk add-tag (200 profiles) | 1701 |
| sort direction toggle (200 rows) | 316 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
