# Storage/Cookie editor — live UX walkthrough (2026-09-09)

The profile-editor's Storage tab (cookie + localStorage viewer/editor) had
never been exercised as a real end-user flow in any audit round before this
one — only via unit tests with mocked IPC. This is a real, live walkthrough
against the actual dev build (`npm run build:electron && npm run build:renderer`,
better-sqlite3 rebuilt for the Electron ABI), driven via computer-use against
the running app, not a simulated/mocked interaction.

## Flow tested

1. Created a fresh profile from the Profiles page.
2. Opened Edit → Storage tab **before** starting the profile.
   - The tab correctly detects the profile isn't running and shows a plain-
     language explanation instead of empty/broken cookie and localStorage
     panels: "Запустіть профіль, щоб переглянути чи редагувати cookies — вони
     існують лише в його активній сесії" (same wording for Local Storage).
     This is the right call — cookies/localStorage genuinely only exist
     inside a live Chromium session for this architecture, and the UI is
     honest about that rather than showing a misleading empty state.
3. Started the profile, navigated to google.com inside it, reopened the
   Storage tab (now while running).
   - Cookies panel populated with the real, live cookies from the session
     (`__Secure-3PSID`-style google.com cookies, expiry dates, etc.) via
     "Оновити" (Refresh).
   - Added a cookie via the "Додати cookie" form (URL `example.com`, name
     `testcookie`, value `hello123`, `Secure` checked by default, "Зберігати
     1 рік" left unchecked) → appeared in the table immediately, correctly
     marked "Сесійний" (session cookie) since the persist-for-a-year box was
     left unchecked.
   - Deleted that cookie via its row's trash icon → removed instantly, no
     confirmation dialog (see finding below).
   - Local Storage panel showed a real existing key
     (`sb_wiz.zpc.gws-wiz.` → a JSON blob) with an honest caption noting the
     panel only reflects the profile's *first* tab's origin
     (`https://www.google.com`), unlike cookies which aren't scoped to a
     single tab — a real, correctly-documented limitation of reading
     localStorage via a page-scoped API rather than a session-wide one.
   - Added a localStorage entry (`myKey` → `myValue123`) via "Додати запис"
     → appeared immediately. Deleted it via its trash icon → removed
     instantly.
4. Stopped the profile, deleted the test profile (soft-delete with an
   "Скасувати" undo toast, consistent with the rest of the app), closed the
   app.

## Result

No crash, no stuck state, no data-loss risk observed across create → running
→ edit → delete for both cookies and localStorage. The feature works as
documented.

**Real friction points found (both minor, neither a functional bug):**

- Deleting a cookie or a localStorage entry is instant and irreversible —
  no confirmation, no undo toast (unlike deleting a whole profile, which
  does get an undo toast). For a destructive action a user could trigger
  by a stray click, this is a real inconsistency with the app's own pattern
  elsewhere.
- The "Додати cookie" URL field's placeholder (`example.com`) doesn't hint
  whether a scheme is expected; a bare domain worked correctly in this test,
  but a user coming from a browser's own cookie-editor UI (which usually
  shows a full URL) might reasonably try `https://example.com` and would
  benefit from the field either accepting both forms silently (it does, not
  verified with scheme here) or the placeholder being explicit either way.

Neither point rises to a fix-now bug — both are documented here as real,
observed friction for a future design pass, per this round's own
instruction not to force a fix where the honest finding is "it already
works, with minor rough edges."
