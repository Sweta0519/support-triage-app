# `ai-code-reviewer` report -- PR #3 (`feature/shareable-status-page` -> `main`)

- Date: 2026-09-04, recorded **before merge**
- Tool: `ai-code-reviewer` subagent (read-only) over `git diff main...feature/shareable-status-page`
- Scope note: focused on code quality, migration/TS consistency, clipboard fallback, action error
  handling, page styling, and test quality -- a separate security-auditor pass (recorded in
  `docs/security/audit-share-feature.md`) covered RLS/grants/token-safety/data-exposure.
- Result: **0 blocking, 2 should-fix, 3 nits** -- both should-fix items resolved before merge; the
  nits were assessed and one (double-active-share) was independently closed by the security fix's
  partial unique index.

## Actions taken

| # | Finding | Resolution |
|---|---|---|
| 1 | `SharePanel.tsx`'s clipboard write had no `.catch` and could throw synchronously if `navigator.clipboard` was unavailable | Added feature detection plus `.catch`/`.finally`, with a distinct "Couldn't copy -- select the link above" state |
| 2 | `app/lib/supabase/service.ts`'s header comment hadn't been updated to mention `app/lib/db/shares.ts` as a legitimate importer | Comment updated to name `shares.ts` and explain the token-as-authorization exception |
| 3 (nit) | Repeated "prove visibility" guard across three Server Actions | Left as-is -- matches the file's existing convention rather than introducing a new pattern; not worth a refactor for this PR |
| 4 (nit) | No DB-level constraint against two concurrent active shares | Independently closed by the security-audit fix (partial unique index + revoke-before-insert) |
| 5 (nit) | `Share.revoked` always `false` when returned by `getActiveShareForTicket` (query already filters on it) | Harmless over-fetch, left as-is |

## Report (verbatim)

### Should fix

1. **`app/(app)/tickets/[id]/SharePanel.tsx` -- clipboard write has no failure path.** No
   `.catch`; if `writeText` rejects (permission denied, insecure context, older browser) the click
   silently does nothing but log an unhandled rejection -- the button never indicates failure.
   `navigator.clipboard` can also be `undefined` in some contexts, throwing synchronously. Add a
   `.catch` and feature-detect before calling.

2. **`app/lib/supabase/service.ts` -- stale comment now contradicts the code.** The header comment
   said only `app/lib/ai/` and `app/lib/db/triage.ts` may import this module, but
   `app/lib/db/shares.ts` now also imports it (a legitimate, intentional use for the public-token
   lookup) without the comment being updated -- exactly the kind of doc-rot that matters here,
   since this comment is the documented invariant for where the RLS-bypassing key can be reached
   from.

### Nits (non-blocking)

3. `publishSummaryAction`/`revokeShareAction` each re-implement the same `isUuid` ->
   `getTicketForStaff` -> bail-if-null guard already used in `rerunTriageAction` -- three copies
   now, a missed factoring opportunity, but consistent with the file's existing style.
4. No DB-level constraint stopped two concurrent active shares for one ticket (double-click, two
   tabs) -- the older token would still resolve even though the UI only shows the newest.
5. `Share.revoked` is selected but always `false` given the query's own filter -- harmless
   over-fetch.

### Checked and found fine

- Migration <-> TypeScript consistency: every column lines up exactly with `Share`/
  `PublicSharedSummary` and the `.select(...)` column lists; `status` correctly reuses the
  existing `ticketing.ticket_status` enum.
- Token validation regex matches the token generation exactly.
- Error handling style matches the existing pattern elsewhere in `actions.ts`.
- All new Supabase access lives in `server-only` `app/lib/db/shares.ts`; Server Actions re-verify
  staff visibility before touching the public-facing table; `proxy.ts`'s `/s/` addition adds no
  authorization logic, consistent with "proxy is not an authorization layer"; no new npm
  packages; no secrets added.
- Styling consistency with `TriagePanel.tsx`/`StaffControls.tsx`/the ticket detail page; the
  public page correctly sits outside the `(app)` route group.
- Test quality: follows the existing `toPass`/reload-polling pattern (no bare `sleep`), uses a
  real second unauthenticated browser context, asserts meaningful things (200 vs 404, content
  present/absent).
