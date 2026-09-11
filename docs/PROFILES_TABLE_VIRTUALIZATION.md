# Profiles table virtualization — investigation (react-window)

Generated: 2026-09-04, corrected 2026-09-04 (see "Correction" section below —
the "8x worse than proportional" invert-selection number in the original
investigation turned out to be a measurement artifact, not a real app
cost; the react-window conclusion itself stands, kept intact below)

## Correction, same day — the "8x degradation" was Playwright's own overhead, not the app's

Asked to profile `invert selection`'s ~8x-worse-than-proportional number
via Chrome DevTools Performance and fix the cause (most likely guess:
missing `React.memo`/stable keys in `ProfilesTable.tsx`).

**What profiling actually found, in order:**

1. A first CPU profile (via CDP's `Profiler` domain, capturing the exact
   `getByRole('button', {name: 'Invert selection'}).click()` +
   `expect(locator).toBeHidden()` sequence the original E2E benchmark
   uses) showed **2569ms of the ~3052ms total self-time inside a single
   function: `getTextAlternativeInternal`** — not application code at all.
   That function belongs to Playwright's own injected accessibility-tree
   walker, used internally to resolve `getByRole(..., {name: ...})` and to
   compute whether an element is visible for `toBeHidden()`. It scales
   with total DOM element count on the page, independent of how fast React
   itself re-renders.
2. Re-measuring with a version of the same interaction timed **entirely
   inside the page** (`performance.now()` around a raw
   `document.querySelector(...).click()` and a `requestAnimationFrame`
   poll — no Playwright locator/accessibility-tree resolution in the timed
   window at all) gave **86.1ms**, reproduced 3× in the 84–92ms range —
   not 2500ms+, and not remotely an "8x" scaling problem for 5x the rows.
3. Implemented the originally-guessed fix anyway (`React.memo` with a
   custom comparator on a new `ProfileRow` component, plus O(1)
   `Map`-based proxy/group name lookups replacing per-row `Array.find()`)
   since it's valid, low-risk practice regardless. Re-measured with the
   same in-page method: **88–91ms — statistically unchanged.** Also
   re-ran the *original* Playwright-based benchmark with the fix applied:
   **still ~2517ms — also unchanged.**

**Conclusion: there was no real ~8x application performance bug to fix.**
The fix is kept (see `ProfilesTable.tsx` — it's correct, harmless, and
will matter more once genuinely large row counts make single-row updates
common), but it demonstrably did not move either number, which is the
proof that neither number was measuring what it claimed to. The ~2500ms
figure the original investigation reported was overwhelmingly Playwright's
own `getByRole`/`toBeHidden` accessible-name computation cost at a
~1000-row (≈10,000-interactive-element) DOM size — a property of
`loadTestUIResponsiveness.spec.ts`'s own measurement technique at that
scale, not of the app. The real, isolated app cost for inverting all 1000
checkboxes is ~86ms, which was never a problem. The `sort direction
toggle` and `bulk add-tag` numbers from the original investigation were
not re-profiled this way and should be treated with the same skepticism
until someone does — they were measured with the identical
`getByRole`/`toHaveCount` Playwright methodology and could be inflated by
the same effect.

This does **not** change the react-window conclusion below: that was
based on the 200-row numbers (measured cleanly, at the scale this app's
own brief targets) being comfortably fast, which is still true, and on the
architectural cost of virtualizing being real either way. It does mean the
1000-row table in that conclusion overstated how bad things get before
virtualization would matter — the real picture is more favorable to "don't
implement" than originally written, not less.

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

## Second correction, 2026-09-11 — re-verifying "sort direction toggle" and "bulk add-tag" the same way, per this doc's own open item

The "8x degradation" correction above explicitly flagged these two as
measured with the identical `getByRole`/`toHaveCount` Playwright
methodology that inflated invert-selection's number by ~29× (2569ms of
pure accessibility-tree-walk vs. 86ms of real app cost), and said they
"should be treated with the same skepticism until someone does" the same
in-page re-measurement. This does that — two new permanent tests added to
`loadTestUIResponsiveness.spec.ts`, both timing entirely inside
`page.evaluate()` with no Playwright locator in the timed window,
alongside (not replacing) the existing UI-driven measurements. RAM
checked before escalating (`Get-CimInstance Win32_OperatingSystem`:
17.5GB free of 31.1GB — plenty of headroom for a 1000-row SQLite seed and
one manager window, no real per-profile Chromium processes involved).
Same temporary-`SCALE=1000`-then-revert method as before (not committed
mid-investigation); the two new tests themselves are kept permanently at
the real `SCALE=200`.

**Unlike invert-selection, the honest result here is split — one real
partial artifact, one confirmed-genuine cost, not two more measurement
illusions:**

| Interaction | Playwright-measured @ 1000 rows | In-page-only @ 1000 rows | Verdict |
|---|---|---|---|
| sort direction toggle | 2585ms | **1388ms** | ~46% was real Playwright/`toHaveCount` overhead, but ~1.4s of genuine React re-render cost remains — a real, moderate scaling cost (200 rows: 498ms full / ~300ms in-page-only), not primarily an artifact like invert-selection was. |
| bulk add-tag | 6460ms | **818ms** (raw `profiles:bulkAddTags` IPC call only, no UI) | The gap here isn't a measurement artifact at all — `ProfilesPage.tsx`'s bulk-tag handler calls `await refresh()` after the mutation resolves (confirmed in source), which re-fetches the full profile list and re-renders all 1000 rows *again*, on top of the 1000 real sequential `profiles:update` writes `bulkAddTags`'s own `bulkRun` performs. The full 6460ms is genuine, real, user-experienced latency, now decomposed rather than just re-confirmed: ~818ms backend writes + the remainder is the subsequent full-list refetch/re-render + Playwright's own (much smaller than `getByRole`'s) visibility-check overhead. |

**Conclusion: no code fix from this pass.** Sort-toggle's real ~1.4s cost
at 1000 rows and bulk-add-tag's real ~818ms-plus-refresh cost are both
consistent with — and now more precisely support — the existing
recommendation above: real, moderate, worse-than-200-row costs exist at
1000 rows, but 200 (this app's own "at scale" ceiling) stays comfortably
fast on every number including the new in-page-only ones, so
virtualization still isn't justified by current real usage. What changed
is confidence, not the decision: this doc no longer has an open
"treat with skepticism, unverified" caveat hanging over two of its own
headline numbers.
