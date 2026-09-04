# Profiles table virtualization — investigation (react-window)

Generated: 2026-09-04

## What was asked

Investigate whether `ProfilesTable.tsx` needs row virtualization
(`react-window`) for large stored-profile counts — explicitly an
*investigation*, not a mandate to implement.

## Current state

`ProfilesTable.tsx` renders one real `<tr>` per profile with no pagination
or limiting anywhere in the pipeline: `profiles:list` (the IPC handler)
returns every matching row in one response, and
`computeVisibleProfiles()` (the client-side filter/sort pipeline) only
filters and sorts — it never slices. So the DOM row count always equals
the filtered/sorted profile count, unbounded.

## What was already measured (before this investigation)

`tests/e2e/loadTestUIResponsiveness.spec.ts` already benchmarks the real
manager UI against a real 200-profile database (`docs/LOAD_TEST.md`'s Test
8) — the load-test brief's own definition of "at scale" for this
interaction. Real numbers from that suite:

| Interaction | Time to settle @ 200 rows |
|---|---|
| reload + render | 311ms |
| search (200 → 1 row) | 320ms |
| select-all | 260ms |
| invert selection | 312ms |
| sort direction toggle | 498ms |
| bulk add-tag (200 profiles) | 1988ms |

All comfortably sub-second except bulk add-tag, which is IPC/DB-round-trip
bound (200 real `profiles:update` writes), not a rendering cost —
virtualizing the table would not speed that up at all.

## New measurement for this investigation: 1000 profiles

200 is the ceiling this app's own load-test brief has ever targeted as
"at scale." To find out whether virtualization matters at a genuinely
larger count, `seedLoadTestUiDb.test.ts` and
`loadTestUIResponsiveness.spec.ts` were temporarily pointed at
`SCALE = 1000` (not committed — reverted back to 200 immediately after,
restoring the real fixture) and re-run for real:

| Interaction | @ 200 rows | @ 1000 rows (5×) | Scaling |
|---|---|---|---|
| select-all | 260ms | ~292–305ms | flat — fine |
| invert selection | 312ms | ~2520–2536ms | **~8×**, worse than linear |
| sort direction toggle | 498ms | ~1502–1551ms | ~3×, worse than linear |
| bulk add-tag | 1988ms | ~5000–5950ms | ~3× (backend-bound, not rendering) |

(The `tag filter`/`group filter` sub-tests failed at this temporary scale
because their expected-row-count assertions were hardcoded for the real
200-profile seed's own tag/group distribution, not because of an app bug —
expected, since this was a throwaway scale change, not a permanent one.
`reload + render` and `search` timings weren't captured in this run's
report due to the same knock-on test failure interrupting the file before
their `afterAll` write; not investigated further since the numbers that
did land were already enough to answer the actual question.)

## Conclusion

**Not worth implementing right now, but a real, worth-revisiting cost at
higher counts than this app currently targets.** At 200 profiles — the
scale this project's own load-test brief treats as "at scale" — every
interaction is comfortably fast (sub-350ms, one exception that's
backend-bound). At 1000, two operations that re-render the whole table
(sort toggle, invert selection) get measurably worse than proportionally
slower, which is real evidence of a genuine rendering cost that scales
unfavorably with row count, not just noise.

Weighed against that: `react-window` is not a drop-in change here.
`ProfilesTable.tsx`'s rows aren't independent, presentation-only cells —
selection state, the tag/group columns, and `ProfileContextMenu.tsx`'s
right-click menu are all wired per-row, and virtualizing would mean
re-deriving fixed/estimated row heights, likely breaking the browser's
native in-page find (Ctrl+F) against off-screen rows, and re-plumbing
keyboard navigation that a real `<table>` gets for free. That's a
non-trivial rewrite to pay for a problem that, at the scale this app is
actually validated for today, doesn't measurably exist.

**Recommendation:** don't implement now. Revisit if real usage data (or a
future load-test brief) shows users regularly storing several hundred to
1000+ profiles — at that point the 1000-row numbers above are the
concrete justification, not a guess. If it does become worth doing,
`react-window`'s `FixedSizeList` is the right starting point (row height
is already visually uniform in the current table), but selection state
and the context menu would need to move from row-scoped React state/DOM
handlers to something that works with windowed, unmounted-when-offscreen
rows.
