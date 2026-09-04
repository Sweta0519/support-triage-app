# Security audit -- shareable status page feature (PR #3)

- Date: 2026-09-04
- Tool: `security-auditor` subagent, scoped specifically to `feature/shareable-status-page` vs
  `main`. This is the app's first public, unauthenticated route and first table anonymous
  visitors ever touch, so it got a dedicated audit on top of the four whole-app passes already
  recorded for the base app (`audit-1` through `audit-4`).
- Result: **0 Critical, 2 Warning, 3 Suggestion**. All fixed before merge.

## Fixes applied

| Finding | Fix | Where |
|---|---|---|
| W1: no rate limiting / abuse protection on the public `/s/[token]` route (cost/availability, not data exposure -- 128-bit token entropy already makes guessing a *valid* token infeasible) | New IP-keyed `consume_public_share_rate_limit(ip)`, a sibling of the `auth.uid()`-keyed `consume_rate_limit()` that works for anonymous callers; `service_role`-only execute; wired into `getPublicSharedSummary()` before the token lookup runs | migration `20260904030000_share_hardening.sql`; `app/lib/db/shares.ts`; `app/s/[token]/page.tsx` |
| W2: the revoke policy's `with check` didn't constrain direction, so a raw PATCH could un-revoke a link a colleague deliberately took down | Policy now requires `revoked = true` in `with check` -- one-directional only | migration |
| S1: freeform subject/AI summary could carry incidental PII onto a public page | Left as a content/product consideration, not a code fix -- the publish flow already only ever writes subject/status/summary (verified, no body/email/raw JSON in the path) | -- |
| S2: shares never expired | `expires_at` column, default 30 days, checked (`> now()`) alongside `revoked = false` in the public read | migration; `app/lib/db/shares.ts` |
| S3: two simultaneously-active shares possible for one ticket, leaving an orphaned older token | Partial unique index (`one active per ticket`); `publishTicketSummary()` revokes any existing active share before inserting | migration; `app/lib/db/shares.ts` |

## Report (verbatim)

### Critical

None found. The core design invariant -- `anon` gets zero grant on `ticketing.shared_ticket_summaries`,
and the public route reads via the service-role client with a hard-coded, narrow column list -- is
implemented exactly as documented, not just claimed in comments.

### Warning

**W1. No rate limiting or abuse protection on the public `/s/[token]` route.** Every other
write/expensive path in this app goes through `checkRateLimit()`, but this is the app's *only*
unauthenticated route and it had no throttling at all. 128-bit token entropy makes guessing a
*specific* valid token practically infeasible (sound, comparable to password-reset tokens), so
not a data-exposure risk -- but unlike password-reset tokens these never expired and nothing
stopped a scripted client from hammering the endpoint to run up service-role DB load / Vercel
function invocations. Fix: add a lightweight IP-based rate limit in front of `/s/[token]`, and/or
an expiry as defense in depth.

**W2. Update RLS policy allows un-revoking, not just revoking.** The `using`/`with check` clauses
only required `is_staff()` and `can_view_ticket(ticket_id)` -- they didn't constrain the
transition to `revoked: false -> true`. Any staff member issuing a raw PostgREST PATCH with
`{"revoked": false}` could silently re-publish a link a colleague explicitly took down, defeating
the audit-trail intent. Not an unauthorized-access issue (still gated to staff who can see the
ticket), but a policy gap versus the stated design.

### Suggestion

- Freeform `subject`/AI `summary` can carry incidental customer PII onto a public page -- content
  risk, not a code bug; only `subject`, `status`, and `triage.summary` are ever written (confirmed
  by tracing the exact data path).
- No expiry on published shares -- an `expires_at` column bounds the exposure window for links
  forwarded beyond their intended audience and forgotten.
- Nothing prevented two simultaneously-active shares per ticket -- the UI only shows the newest,
  so an older one becomes an orphaned but still-valid link nobody can see or revoke through the UI.

### Checked and found sound

- `anon` grants -- read directly from the migration (not just comments): `grant select, insert,
  update (revoked) on ... to authenticated; grant all ... to service_role;`. No `grant ... to anon`
  anywhere.
- `getPublicSharedSummary` input handling -- token validated against `^[0-9a-f]{32}$` before any
  query runs (rejects empty/wrong-length/non-hex/arbitrarily-long input pre-query, no ReDoS risk
  either, fixed-length anchored regex); `.eq()` builds a parameterized PostgREST filter, not
  string-concatenated SQL, so no SQL-injection path via the token even without the regex; the
  select list is a hard-coded literal, never a caller-controlled column list or `select *`, never
  a join to `tickets`/`triage_results`.
- Token entropy and extension setup -- `encode(extensions.gen_random_bytes(16), 'hex')` is 128
  bits of CSPRNG output, unique-constrained, fully schema-qualified so immune to `search_path`
  hijacking regardless of the calling role's setting; `pgcrypto` installed into its own
  `extensions` schema, not `public`.
- `app/s/[token]/page.tsx` renders exactly the four snapshot fields; no links to any other app
  route; no call to `cookies()`, `createServerSupabaseClient()`, or any session-aware helper; the
  root layout it inherits has no nav/session UI, so there's no path for authenticated-user state
  to bleed onto this anonymous page.
- `PUBLIC_PATHS` collision check -- `"/s/"` (with trailing slash) via `.startsWith()`; the only
  route under `/s` is `app/s/[token]/page.tsx`, no existing route collides with the prefix.
- Server Actions re-verify visibility -- `publishSummaryAction`/`revokeShareAction` both call
  `requireStaff()` then `getTicketForStaff(ticketId)` (RLS-scoped) before writing, and the
  INSERT/UPDATE RLS policies independently re-check `is_staff()` + `can_view_ticket(ticket_id)` --
  genuine defense-in-depth, not a single point of failure. `ticketId`/`shareId` validated with
  `isUuid()`; error messages don't distinguish not-found from not-visible, so no enumeration
  oracle.
- Column-level UPDATE grant restricts the authenticated role to only the `revoked` column at the
  Postgres level, independent of the RLS policy.
- Data-path trace confirmed: no `body`, `customer_id`, or `triage_results.raw` is ever passed into
  the write.
- Service-role key hygiene and CSP/headers inheritance both confirmed unaffected/correct.

## Follow-up code review

A separate `ai-code-reviewer` pass on the same PR found no blocking issues; two should-fix items
(a missing `.catch` on the clipboard write, and a stale comment in `app/lib/supabase/service.ts`
that hadn't been updated to mention the new caller) were both fixed in the same commit as the
security fixes above. See `docs/reviews/pr-3-ai-code-reviewer.md`.
