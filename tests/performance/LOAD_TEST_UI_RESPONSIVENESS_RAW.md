# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T13:06:00.260Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 167 |
| search (200 -> 1 row) | 644 |
| tag filter (even5) | 184 |
| group filter (Load UI Group A) | 149 |
| select-all (200 rows) | 372 |
| invert selection (200 -> 0) | 223 |
| bulk add-tag (200 profiles) | 401 |
| sort direction toggle (200 rows) | 474 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
