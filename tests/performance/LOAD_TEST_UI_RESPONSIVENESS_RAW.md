# Load test — UI responsiveness at 200 stored profiles (raw data)

Generated: 2026-09-01T11:42:32.124Z

| Interaction | Time to settle (ms) |
|---|---|
| reload + render 200 rows | 317 |
| search (200 -> 1 row) | 487 |
| tag filter (even5) | 169 |
| group filter (Load UI Group A) | 163 |
| select-all (200 rows) | 373 |
| invert selection (200 -> 0) | 282 |
| bulk add-tag (200 profiles) | 419 |
| sort direction toggle (200 rows) | 503 |

_Real measured numbers from this machine/run — not fabricated. "Time to settle" is wall-clock from triggering the interaction to Playwright observing the expected DOM state, i.e. it includes real render time, not just the click._
