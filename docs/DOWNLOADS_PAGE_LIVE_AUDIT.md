# Downloads page — live UX walkthrough (2026-09-10)

The Downloads page had never been walked through as a real end-user flow
in any prior audit round. Driven live via computer-use against the actual
dev build — a real profile, a real network download (npm's registry,
`lodash-4.17.21.tgz`, chosen for being a small, stable, non-HTML-rendered
binary that Chromium genuinely downloads rather than displaying inline).

## Flow tested

1. Created a profile, started it, navigated directly to the `.tgz` URL.
2. The download appeared in the Downloads page with the correct filename,
   profile name, size (311 KB), timestamp, and a "Завершено" (Completed)
   status — correct on the first real try.
3. **Показати в папці** (Show in folder) opened a real Windows Explorer
   window, file pre-selected, correct real path (`.../browser-data/
   downloads/lodash-4.17.21.tgz`).
4. Search filter (`lodash`) correctly matched; a non-matching term
   correctly showed the distinct "no rows match the filter" empty state
   (as opposed to the "no downloads at all" empty state — both exist and
   both render correctly).
5. Deleted the file **outside the app** (a real filesystem delete, not
   through the UI) and confirmed the page correctly flips the row to
   "Відсутній" (Missing) on next load — the "Open"/"Show in folder"
   buttons correctly disappear, leaving only Redownload/Delete. Confirms
   `downloads:list`'s own `missing: state === 'completed' &&
   !fs.existsSync(savePath)` check genuinely works against the real
   filesystem, not just its own DB state.
6. **Real bug found**: clicked **Перезавантажити** (Redownload) while the
   source profile was still running — `profileManager.start()` correctly
   throws `Error('Profile is already running')` (by design; there's no
   back-channel into an already-running profile's separate OS process),
   but **nothing was shown to the user at all** — no banner, no toast, no
   visible change. Confirmed in `DownloadsPage.tsx`: the page's *own*
   `error` (from the list-loading `useAsyncAction()` instance) is
   rendered as a banner, but the *separate* `actionRunner.error` — which
   actually drives Open/Show-in-folder/Delete/Redownload — was captured
   into state but never rendered anywhere in the JSX. A real failure from
   any of those four actions failed completely silently to a real user
   (only visible via `describeError()`'s own `console.error`, which
   nobody but a developer opens).
7. Stopped the profile, retried Redownload — worked correctly, the file
   re-downloaded to the same path. Confirms the *feature itself* (not
   just its error path) is correct; the bug was purely the missing error
   feedback.

## Fixed

`DownloadsPage.tsx`: added `{actionRunner.error && <div className="banner
banner-error">{actionRunner.error}</div>}` alongside the existing `error`
banner. Verified fixed live: after the fix, clicking Redownload on a
running profile now shows a clear banner — *"Цей профіль уже запущено."*
Added a permanent unit test (`tests/unit/DownloadsPage.test.tsx`) covering
this exact scenario.

## Noted, not fixed — a real but minor UI-staleness gap

The Downloads list does not auto-refresh when a download started from
elsewhere (e.g. a just-triggered Redownload) actually completes — `load()`
only re-runs when a filter changes, never on a push/event. A user sitting
on the page watching a redownload they just triggered won't see the result
appear until they change a filter or navigate away and back. There's no
cross-window event path for this today (the profile browser's own
`win.webContents.send('pf:download-event', ...)` only reaches that
profile's *own* browser-shell window, never the separate manager window
the Downloads page lives in) — wiring that up is a larger change than this
round's scope. Documented here as a real, observed friction point for a
future pass, not silently accepted as fine.
