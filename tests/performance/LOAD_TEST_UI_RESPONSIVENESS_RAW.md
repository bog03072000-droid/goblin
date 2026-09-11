# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-11T19:23:15.479Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 320 |
| search (200 -> 1 row) | 542 |
| tag filter (even5) | 60 |
| group filter (Load UI Group A) | 202 |
| select-all (200 rows) | 313 |
| invert selection (200 -> 0) | 564 |
| bulk add-tag (200 profiles) | 354 |
| sort direction toggle (200 rows) | 501 |
| sort direction toggle (200 rows, in-page only) | 302 |
| bulk add-tag (200 profiles, in-page IPC only) | 35 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
