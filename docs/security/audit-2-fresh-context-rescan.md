# Security audit #2 -- fresh-context rescan

- Date: 2026-09-03
- Tool: `security-auditor` subagent started as a **new agent with no memory of audit #1 or of
  the fixes**, instructed to re-examine every file and migration from scratch and only consult
  `audit-1-initial.md` at the very end for the comparison section
- Scope: all 8 migrations reduced to their cumulative effective state, every file under `app/`,
  `proxy.ts`, `next.config.ts`, `.gitignore`, `.env.example`, `.env.local` (names only),
  `supabase/config.toml`, both docs, all tests, and the relevant Next 16.3.4 internals for
  redirect and Server Action handling
- Result: **0 Critical, 3 Warning, 7 Suggestion**. 13 of audit #1's 17 items confirmed resolved,
  3 still open (documented gaps), 1 incomplete fix (W8 -> W1 below).
- Follow-up: the three Warnings and the actionable Suggestions were fixed (see below), then a
  **third fresh-context audit** ran -- `audit-3-fresh-context-rescan.md`.

## Fixes applied

| Finding | Fix | Where |
|---|---|---|
| W1 Open redirect via a same-origin URL whose *pathname* starts with `//` or `/\` (incomplete fix of audit-1 W8) | After the origin check, the pathname must match `^\/(?![/\\])`; otherwise fall back to `/` | `app/auth/confirm/route.ts` |
| W2 Table-wide INSERT grants let a client set `created_at`, `first_response_at`, etc. on insert | `INSERT` is now column-level: `tickets (customer_id, subject, body)`, `ticket_comments (ticket_id, author_id, body, is_internal)`; the insert policy also pins the three timestamps to null | migration `20260903070000_audit2_fixes.sql` |
| W3 Untrusted text can close the prompt's delimiter tags; second-order injection via summaries | `<`/`>` replaced with full-width equivalents in the ticket subject/body and in every candidate field before interpolation; URLs/emails in `suggested_reply` that don't appear in the ticket itself are replaced with `[link removed]`; the draft's caption tells the agent it was written with other tickets as context | `app/lib/ai/triage.ts`, `TriagePanel.tsx` |
| S1 Existing helpers still had default PUBLIC EXECUTE | Explicit `revoke ... from public` + `grant ... to authenticated[, service_role]` on every callable function | migration |
| S2 `consume_rate_limit` accepted arbitrary `p_action` / windows | Action whitelisted to `create_ticket` / `add_comment` / `rerun_triage`; window capped at 24h | migration |
| S3 `handle_new_user` would fail (and break the other app's signup) for a user without an email | Trigger skips users with no email; `ensure_profile()` raises a clear error instead | migration |
| S4 Staff could file tickets; `.single()` turned RLS-hidden rows into 500s | `requireRole("customer")` on ticket creation (action and both pages); `assignTicket`/`updateTicketStatus` use `.maybeSingle()` | `app/(app)/tickets/*`, `app/lib/db/tickets.ts` |
| S5 CSP `script-src 'unsafe-inline'` | Not changed -- documented gap (nonce-based CSP is the next step) | -- |
| S6 Dashboard-only auth settings | Not code; operator checklist below | -- |
| S7 Minor (`full_name` writable but never rendered; raw sign-in error text; project ref in docs) | Left as is; none is a current exposure | -- |

Operator checklist (not capturable in migrations; shared `auth.users` means these also govern
notes-collections): Supabase Dashboard -> Authentication: minimum password length >= 8, email
confirmations on, sign-in/sign-up rate limits set, redirect allow-list without a `/**` wildcard.

## Report (verbatim)

### Critical

None found. The service-role and OpenRouter keys are read only in `server-only` modules that no
`"use client"` file imports; `anon` has no USAGE on `ticketing`; all 7 tables have RLS enabled;
no path was found by which a customer reads another customer's ticket, comments, events, or
triage output, and no role self-escalation path (signup metadata, profile update, or RPC).

### Warning

**W1. Open redirect in `/auth/confirm` via a same-origin URL whose path starts with `//`**
`app/auth/confirm/route.ts:21-35, :51`. `safeNextPath` resolves `next` against `SITE_URL`, checks
`origin` equality, then returns only `pathname + search`. A URL pathname may legally begin with
`//`, and browsers treat a Location of `//evil.com` as protocol-relative. Verified:
`new URL("https://support-triage-app-one.vercel.app//evil.com")` is "same origin" and yields
`pathname === "//evil.com"`; Next writes the redirect value verbatim. Not reachable today because
the app never threads `next` into a link; becomes live if the email template uses
`next={{ .RedirectTo }}` with a wildcard allow-list. Fix: reject pathnames not matching
`/^\/(?![\/\\])/` (or redirect to the absolute same-origin URL).

**W2. Table-wide INSERT grants let clients set server-owned columns on insert**
`20260903010000_tickets.sql:61` and `20260903020000_...sql:52`. UPDATE was narrowed to five
columns in the audit-1 fix but INSERT stayed table-wide, and the insert policy does not
constrain `created_at`, `updated_at`, `first_response_at`, `resolved_at`, `closed_at`, `id`.
Exploit: POST `/rest/v1/tickets` with `created_at: "2000-01-01"` puts the ticket at the top of
every agent's queue permanently; `first_response_at` on insert corrupts "Avg first response".
Fix: column-level INSERT grants; optionally pin the timestamps to null in WITH CHECK.

**W3. Prompt-injection surface: untrusted text can close the delimiter tags; model-derived
summaries are fed back as trusted-looking context**
`app/lib/ai/triage.ts:156-199`. `sanitizeCandidateText` strips newlines but not `<`/`>`, and the
current ticket's own subject/body are interpolated unsanitised, so `</ticket_body>` followed by
instructions is trivially injectable. `latest_summary` is prior model output about another
customer's ticket, so an injection in ticket A is laundered into a "summary" shown as context for
every later similar ticket. Impact bounded (staff-only, advisory, human in the loop). Fix: escape
or strip `<`/`>`; post-filter `suggested_reply` for URLs/emails not present in the current
ticket; tell the agent the draft may contain content from other tickets.

### Suggestion

- **S1** `app_role`, `is_staff`, `is_admin`, `can_view_ticket` and every trigger function were
  created before `alter default privileges ... revoke execute from public`, which only affects
  future objects; `create or replace` preserves existing ACLs. Benign today (`anon` lacks schema
  USAGE). Fix with explicit revoke/grant.
- **S2** `consume_rate_limit` accepts an unbounded `p_action` and arbitrary `p_window_seconds`
  from any authenticated caller -- a storage-growth vector limited to the caller's own buckets.
  Whitelist the action.
- **S3** `handle_new_user` aborts any `auth.users` insert with no email (`profiles.email` is
  `not null`), which would break signups for notes-collections too if phone/anonymous auth were
  ever enabled. Skip or coalesce.
- **S4** Ticket creation uses `requireProfile()` (any role); `assignTicket`/`updateTicketStatus`
  use `.single()` so an RLS-hidden row throws a 500 rather than a clean no-op.
- **S5** CSP `script-src 'unsafe-inline'` remains (known gap; nonce via `proxy.ts`). Consider
  `Cross-Origin-Opener-Policy: same-origin`.
- **S6** Server-side minimum password length, auth rate limits, email confirmation and the
  redirect allow-list are dashboard-only; `config.toml` shows local-dev defaults of 6 / off.
- **S7** `profiles.full_name` remains user-writable but is never rendered; `signInAction` returns
  Supabase's raw error text; `.env.local` holds a short-lived `VERCEL_OIDC_TOKEN` (gitignored);
  `docs/supabase-schema.md` publishes the (non-secret) project ref.

### Checked and found sound

- RLS enabled on all 7 `ticketing` tables; `rate_limits` and `ticket_embeddings` deny-all; no
  DELETE grant or policy anywhere; `anon` has no USAGE on the schema.
- Effective grants after migration 6: `profiles` select + update(`full_name`, `updated_at`);
  `tickets` select, insert, update(`status, assignee_id, priority, category, team`);
  `ticket_comments` select, insert; `ticket_events`, `triage_results` select only. `role`,
  `email`, `triage_status`, timestamps and ticket text are unreachable for UPDATE.
- `tickets_select` / `tickets_update_staff`: customers own rows only; agents unassigned-or-own on
  both USING and WITH CHECK; admins everything; atomic claim via `.is("assignee_id", null)`.
- `guard_ticket_update` (final form): immutable `customer_id/subject/body`; assignee must be
  agent/admin; transition map bypassed only by `is_admin()`, which is false for `service_role`,
  so triage can never move status; `resolved_at`/`closed_at` server-stamped; events written as
  DEFINER since clients have no INSERT on `ticket_events`.
- `can_view_ticket` is SECURITY INVOKER (correct); `is_*` helpers are DEFINER to avoid profiles
  self-recursion; every function has `set search_path = ''` with fully qualified names;
  `match_tickets` executable by `service_role` only.
- Role model: `handle_new_user` and `ensure_profile` hard-code `customer`; `signUpAction` passes
  no `options.data`; `admin_set_role` re-checks `is_admin()`, refuses self-change and last-admin
  demotion, unassigns tickets on demotion; role read from the DB per request, never from JWT.
- Rate limits enforced by `BEFORE INSERT` triggers, so direct Data API inserts are limited
  identically; the exception rolls back the counter increment but the window stays at the limit,
  so the lockout holds for the whole window.
- `profiles.email` no longer client-writable, unique on `lower(email)`, synced from `auth.users`.
- Service-role confinement holds; no `NEXT_PUBLIC_` variable holds a secret; only `.env.example`
  is tracked.
- Every mutation is a Server Action (built-in POST + Origin/Host check; `allowedOrigins` valid
  for Next 16). The only Route Handler is GET `/auth/confirm`, which validates `type`. Staff
  actions validate UUIDs and enum values; `rerunTriageAction` proves visibility through the
  caller's RLS before any service-role write and is rate-limited.
- Cookies `httpOnly`, `secure` in production, `SameSite=Lax`; no browser Supabase client.
  `proxy.ts` only refreshes the session; role gating in `require*` + RLS; `/admin` gated at
  layout and page.
- Customers never see triage output or AI-derived priority/category; `raw` jsonb excluded from
  selected columns; output schema strict with candidate ids as enums, re-validated in TypeScript;
  body truncation, `max_tokens`, 45 s timeout and one retry bound cost.
- `SITE_URL` from env, never request headers; `listQueueTickets` interpolates only a
  server-derived uuid.

### Comparison with audit #1

Resolved: W1, W2, W3, W4, W5 (partially -- see W3 above), W6, W7, S1, S4, S5, S6, S7, S9.
Still open: S2 (default privileges only affect future functions), S3 (`'unsafe-inline'`), S8
(dashboard-only settings).
Regressed / incomplete: W8 -- the backslash case is fixed but the new origin comparison is
bypassed by a same-origin URL whose path begins with `//` or `/\` (W1 above).
New: W2 (INSERT counterpart of audit-1 W6), the tag-closing and second-order aspects of W3, S2,
S3, S4.
