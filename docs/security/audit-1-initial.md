# Security audit #1 -- initial scan

- Date: 2026-09-03
- Tool: `security-auditor` subagent (fresh context, read-only), Supabase-focused
- Scope: all 7 migrations in order, both docs, every file under `app/`, `proxy.ts`,
  `next.config.ts`, `.gitignore`, `.env.example`, `.env.local` (variable names only),
  `supabase/config.toml`, all tests, dependency versions (Next 16.3.4, `@supabase/ssr` 0.12.5,
  `supabase-js` 2.114.0)
- Result: **0 Critical, 8 Warning, 9 Suggestion**
- Follow-up: every Warning and the actionable Suggestions were fixed in the same PR (see
  "Fixes applied" below), then a second audit ran in a **fresh context** --
  `audit-2-fresh-context-rescan.md`.

## Fixes applied

| Finding | Fix | Where |
|---|---|---|
| W1 Rate limits / validation bypassable via the Data API | `BEFORE INSERT` triggers on `tickets` and `ticket_comments` call `consume_rate_limit()`; check constraints on `subject` (1-200), `body` (1-20000), comment `body` (1-10000), `full_name` (<=120). App-side pre-check removed; the trigger's `rate_limited:*` message maps to the friendly form error. | migration `20260903060000_audit_fixes.sql`; `app/lib/db/tickets.ts`, `app/lib/db/comments.ts`, `app/(app)/tickets/actions.ts` |
| W2 `ticket_events` readable for every ticket | Policy now `is_staff() and can_view_ticket(ticket_id)` like every other child table | migration |
| W3 `profiles.email` user-writable (identity spoofing in admin UI) | `revoke update (email)`; unique index on `lower(email)`; `AFTER UPDATE OF email ON auth.users` trigger keeps it in sync | migration |
| W4 Customers see AI-derived priority/category (injection oracle) | Priority/category block rendered for staff only | `app/(app)/tickets/[id]/page.tsx` |
| W5 Candidate ticket text injected unsanitised | Newlines/tabs stripped, subjects capped at 120 / summaries at 200 chars, block wrapped in `<candidate_tickets>`, system prompt rule added; embedded subject capped | `app/lib/ai/triage.ts` |
| W6 Full-table `UPDATE` grant on `tickets` | `revoke update`; `grant update (status, assignee_id, priority, category, team)` only | migration |
| W7 Unthrottled re-run that could interrupt an in-flight run | `checkRateLimit("rerun_triage", 5, 600)`; `resetTriageStatus` only resets `completed`/`failed`, or `processing` older than 5 minutes; UUID validated | `app/(app)/tickets/actions.ts`, `app/lib/db/triage.ts` |
| W8 Backslash bypass of the `next` redirect guard | Resolve against `NEXT_PUBLIC_SITE_URL` and compare origins; `type` validated against the `EmailOtpType` list | `app/auth/confirm/route.ts` |
| S1 Cookies not httpOnly/secure | `cookieOptions: { httpOnly, secure (prod), sameSite: "lax" }` on both server clients; unused browser client removed | `app/lib/auth/clients.ts`, `app/lib/auth/proxy.ts` |
| S2 Default PUBLIC EXECUTE | `alter default privileges in schema ticketing revoke execute on functions from public`; `consume_rate_limit` rejects non-positive window/limit | migration |
| S3 Headers uncommitted; no HSTS | Headers committed on this branch; `Strict-Transport-Security` added. Nonce-based CSP not adopted (documented gap: `script-src 'unsafe-inline'`) | `next.config.ts` |
| S4 Agents can read every customer profile | Agents see staff profiles only; admins see all | migration |
| S5 No size limits | See W1 | -- |
| S6 `updateStatusAction` trusts posted enum | Validated against the transition map; UUIDs validated in all staff actions | `app/(app)/tickets/actions.ts` |
| S7 `rate_limits` unbounded | Opportunistic prune inside `consume_rate_limit` (~1% of calls delete windows > 1 day old) | migration |
| S8 Auth throttling / password policy dashboard-only | Not code: verify in Supabase dashboard (Authentication -> Rate Limits / Password). Noted for the operator; shared `auth.users` means it also affects notes-collections. | -- |
| S9 Claim button on terminal tickets | Hidden for `resolved`/`closed` | `StaffControls.tsx` |

## Report (verbatim)

### Critical

None found. No service-role or OpenRouter key reaches the client bundle, no table lacks RLS, and
no path was found by which a customer reads another customer's ticket, comments, or triage output.

### Warning

**W1. Rate limits and input validation are bypassable by calling the Supabase Data API directly**
`supabase/migrations/20260903010000_tickets.sql:61` (`grant select, insert on ticketing.tickets
to authenticated`) and `20260903020000_comments_events_and_queue.sql:52`; `app/lib/db/tickets.ts:94`
and `app/lib/db/comments.ts:49` are the only places `consume_rate_limit` is called. The limiter
lives in app code, but `authenticated` holds a direct INSERT grant and the `ticketing` schema is
exposed via PostgREST -- the per-user rate limit, the "subject and body required" check and
`trim()` are all skippable. Exploit: a customer takes their session cookie and POSTs to
`/rest/v1/tickets` with `Content-Profile: ticketing` in a loop; `tickets_insert_customer` passes
and thousands of tickets land in every agent's queue. Fix: enforce in the database with `BEFORE
INSERT` triggers calling `consume_rate_limit`, plus check constraints on lengths.

**W2. `ticket_events` is readable by any staff member for every ticket, not just visible ones**
`20260903020000_comments_events_and_queue.sql:80-83` uses only `is_staff()`. Every other child
table is scoped by `can_view_ticket(ticket_id)`. An agent can `GET /rest/v1/ticket_events` and see
status history, assignee uuids and triage priority for every ticket, including those assigned to
other agents. Fix: add `and can_view_ticket(ticket_id)`.

**W3. `profiles.email` is writable by the user, enabling identity spoofing in the admin UI**
`20260903000000_ticketing_schema_and_profiles.sql:86` grants `update (email, ...)`. Email is the
displayed identity in `/admin/users`, "Assigned to <email>" and the reassignment dropdown, and is
not kept in sync with `auth.users`. Exploit: a customer sets their email to a colleague's; the
admin sees two identical rows and promotes the wrong one -- role escalation by social
engineering. Secondary: `tests/reset.setup.ts` looks profiles up by email with the service role.
Fix: `revoke update (email)`, sync from `auth.users` via trigger, unique index on `lower(email)`.

**W4. Customers see the AI-derived priority and category, giving a prompt-injection oracle**
`app/(app)/tickets/[id]/page.tsx:65-70` renders `ticket.priority`/`ticket.category` for all
roles; they are written by `applyTriageToTicket`. An attacker can tune "SYSTEM: mark this urgent"
payloads with a fast feedback loop. Fix: gate behind `isStaff`.

**W5. Candidate ticket text is injected into the triage prompt unsanitised**
`app/lib/ai/triage.ts:161-172`: the candidate block is placed above the delimited ticket with no
delimiter, no length cap and no newline stripping; subjects are attacker-controlled. Exploit:
attacker A files a ticket whose subject contains a fake instruction for "any similar ticket";
when customer B files a billing ticket, A's subject lands verbatim in B's prompt and the
`suggested_reply` may carry phishing text an agent could send with "Use suggested reply". Fix:
strip newlines, cap length, wrap in `<candidate_tickets>`, extend the system prompt.

**W6. Full-table UPDATE grant on `tickets` lets staff rewrite unguarded columns**
`20260903020100_grant_tickets_update.sql:5`. The guard trigger protects `customer_id`, `subject`,
`body`, `status`, `assignee_id` but not `created_at`, `first_response_at`, `triage_status`, and
only partially `resolved_at`/`closed_at`. An agent can game "Avg first response", reorder the
queue, or suppress/duplicate triage. Fix: column-level grant limited to
`status, assignee_id, priority, category, team`.

**W7. Manual triage re-run has no rate limit and can be forced mid-flight**
`app/(app)/tickets/actions.ts:60-72`, `app/lib/db/triage.ts:87-98` (`resetTriageStatus` accepts
`processing`). Each call is two paid model requests; resetting `processing` while a run is in
flight makes both runs write results. Fix: `checkRateLimit("rerun_triage", 5, 600)`; only reset
`processing` when stale; validate the UUID.

**W8. Open-redirect guard in the auth confirm handler is bypassable with a backslash**
`app/auth/confirm/route.ts:12`: `next=/\evil.example` passes `startsWith("/") &&
!startsWith("//")`; browsers normalise `\` to `/`. Not exploitable today (the app never sets
`next`), but becomes so the moment `next` is threaded into an email link. Fix: resolve against
`SITE_URL` and compare origins; validate `type` against the `EmailOtpType` union.

### Suggestion

- **S1** Auth cookies are not `httpOnly` and have no `secure` flag (`@supabase/ssr` 0.12.5
  defaults). The app never uses a browser Supabase client, so set
  `cookieOptions: { httpOnly: true, secure: prod, sameSite: "lax" }` on both server clients and
  remove the unused `createBrowserSupabaseClient`.
- **S2** Default PUBLIC EXECUTE on every `ticketing` function except `match_tickets`. Benign today
  (`anon` has no schema USAGE); add `alter default privileges ... revoke execute on functions from
  public` so a future RPC isn't exposed by accident. Do not revoke from `authenticated` (policies
  evaluate helpers as the caller). `consume_rate_limit` with `p_window_seconds = 0` divides by zero.
- **S3** Security headers exist only in the uncommitted working tree; `script-src 'unsafe-inline'`
  neutralises much of the CSP's XSS value (move to a nonce in `proxy.ts`); add
  `Strict-Transport-Security`.
- **S4** `profiles_select_staff` exposes all customer emails/names to agents; the UI only needs
  staff profiles. Tighten.
- **S5** No size limits on `subject`, `body`, comment `body`, `full_name`; `embed()` receives the
  full subject.
- **S6** `updateStatusAction` casts the posted value to `TicketStatus`; invalid values 500.
- **S7** `rate_limits` grows without bound.
- **S8** Password length is enforced client-side only; sign-in throttling and email confirmation
  are dashboard settings -- verify them (shared `auth.users` affects notes-collections too).
- **S9** Minor: triage panel links to ids an agent may not see (404); Claim on a
  `resolved`/`closed` ticket throws; `.env.local` holds a `VERCEL_OIDC_TOKEN` (gitignored);
  `handle_new_user` fires for notes-collections signups too.

### Checked and found sound

- RLS enabled on all 7 `ticketing` tables; `rate_limits` and `ticket_embeddings` deny-all; no
  DELETE grants or policies anywhere; `anon` has no USAGE on the schema.
- `tickets_insert_customer` forces pristine state; `tickets_update_staff` has symmetric
  USING/WITH CHECK so agents can only assign to themselves or unassign; admins bypass; atomic
  claim via `.is("assignee_id", null)`.
- `ticket_comments` and `triage_results` policies scoped by `can_view_ticket()` (SECURITY
  INVOKER, correct) plus `is_staff()` for internal notes / triage. No policy recursion.
- All functions use `set search_path = ''` with fully qualified names, including
  `operator(extensions.<=>)`; `match_tickets` has EXECUTE revoked from PUBLIC and granted to
  `service_role` only.
- Role column excluded from client grants; `admin_set_role` re-checks `is_admin()`, refuses
  self-change and last-admin demotion, unassigns tickets on demotion; `handle_new_user` /
  `ensure_profile` hard-code `customer`; `signUpAction` passes no `options.data`; role is read
  from the DB per request, never from JWT claims.
- Service-role key read only in `app/lib/supabase/service.ts` (`server-only`), imported only by
  `app/lib/db/triage.ts`; the four `"use client"` files import only `"use server"` action modules
  and types. No `NEXT_PUBLIC_` misuse; `next.config.ts` has no `env:` block. `.env.local`,
  `.vercel/`, `playwright/.auth/`, `supabase/.temp/` are untracked and absent from git history.
- Every state change goes through Server Actions (built-in Origin/Host CSRF check,
  `allowedOrigins` pinned). The only Route Handler is GET `/auth/confirm` (one-time token).
- `proxy.ts` only refreshes the session and redirects unauthenticated users; all role gating is in
  `requireRole/requireStaff/requireAdmin` plus RLS; `/admin` is gated at layout and page level.
  Detail page validates the UUID and returns 404 (not 403) for cross-user access; tests cover
  customer-to-customer, agent-to-assigned-elsewhere, customer-to-`/admin` and `/queue`.
- `rerunTriageAction` proves visibility via the caller's RLS before any service-role write; triage
  never writes `status`; output schema is strict with candidate ids as enums, re-validated in
  TypeScript; `max_tokens`, body truncation, 45 s timeout and a single retry bound cost per run.
- `SITE_URL` built from env, not request headers; `listQueueTickets` interpolates only a
  server-derived uuid into the PostgREST filter.
