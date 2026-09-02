# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-02T07:42:07.971Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 311 |
| search (200 -> 1 row) | 320 |
| tag filter (even5) | 154 |
| group filter (Load UI Group A) | 216 |
| select-all (200 rows) | 260 |
| invert selection (200 -> 0) | 312 |
| bulk add-tag (200 profiles) | 1988 |
| sort direction toggle (200 rows) | 498 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
