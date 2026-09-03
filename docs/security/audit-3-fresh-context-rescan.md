# Security audit #3 -- fresh-context rescan

- Date: 2026-09-03
- Tool: `security-auditor` subagent started as a **new agent with no memory of audits #1/#2 or
  of the fixes**, instructed to re-examine every file and migration from scratch and only consult
  `audit-2-fresh-context-rescan.md` at the very end for the comparison section
- Scope: all 9 migrations reduced to their cumulative effective state; every file under `app/`;
  `proxy.ts`; `next.config.ts`; `supabase/config.toml`; `.gitignore`; `.env.example`;
  `.env.local` (names only); `tests/`; `playwright.config.ts`; both docs; README; CLAUDE.md. It
  also executed a copy of `safeNextPath` against 32 redirect edge cases.
- Result: **0 Critical, 2 Warning, 11 Suggestion**. Every audit-2 Warning confirmed resolved; no
  regressions.
- Follow-up: both Warnings and the actionable Suggestions were fixed (below), then a **fourth
  fresh-context audit** ran -- `audit-4-fresh-context-rescan.md`.

## Fixes applied

| Finding | Fix | Where |
|---|---|---|
| W1 Customers could read the AI-derived `priority`/`category`/`team`/`triage_status` on their own `tickets` row through the Data API -- the "no feedback loop" property was UI-only | Those columns are **dropped from `tickets`** and moved to a new staff-only table `ticket_triage_state` (RLS `is_staff() and can_view_ticket()`, row auto-created by trigger, written only by the service role). Staff reads embed it; for a customer the embed is `null` | migration `20260903090000_audit3_fixes.sql`; `app/lib/db/tickets.ts`, `triage.ts`, `admin.ts`; queue and ticket pages |
| W2 `consume_rate_limit(p_action, p_limit, p_window_seconds)` let any authenticated caller mint one `rate_limits` row per call with a different window | Signature is now `consume_rate_limit(p_action)`; limit and window are a fixed per-action lookup inside the function | migration; `app/lib/db/rate-limit.ts` |
| S1 Last-admin check in `admin_set_role` racy | `pg_advisory_xact_lock` taken before the check | migration |
| S2 `resolved_at` wiped on `resolved -> closed` | Cleared only when moving back to an open status | migration |
| S3 Re-run would overwrite staff overrides | Not applicable yet -- only the service role writes the working state; no staff-override UI exists. Revisit when one is added | -- |
| S4 CSP `'unsafe-inline'` | Documented gap; unchanged | -- |
| S5 Ticket text sent to model providers with no data-handling control | `provider.data_collection = "deny"` on both OpenRouter calls; documented in `docs/ai-triage.md` Privacy | `app/lib/ai/openrouter.ts` |
| S6 Bare `host.tld/path` links survive `stripForeignLinks`; `missing_info` items uncapped | Regex extended to bare domains with a path; items trimmed to 200 chars | `app/lib/ai/triage.ts` |
| S7 Unique index on `lower(email)` could make the shared-`auth.users` triggers abort another app's write | `handle_new_user` and `sync_profile_email` swallow `unique_violation` | migration |
| S8 `clients.ts` lacked `server-only`; stale comment in `service.ts` | Both fixed | `app/lib/auth/clients.ts`, `app/lib/supabase/service.ts` |
| S9 `config.toml` didn't expose `ticketing` locally; `MAX_ROWS = 5000` vs PostgREST's 1,000 cap made `sampled` unreachable | `ticketing` added to local `schemas`; `MAX_ROWS = 1000` | `supabase/config.toml`, `app/lib/db/admin.ts` |
| S10 `full_name` client-writable but unused; comments allowed on closed tickets; `tickets_insert_customer` didn't check role | UPDATE on `profiles` revoked entirely (policy dropped); comment insert requires the ticket not be `closed`; role check was already added in `20260903080000` | migration |
| S11 Dashboard-only auth settings; migration application | Operator checklist retained in `audit-2-fresh-context-rescan.md`; `npx supabase migration list` shows all 9 applied | -- |

## Report (verbatim)

### Critical

None found.

- Service-role key: read only in `app/lib/supabase/service.ts` (`server-only`) and
  `tests/reset.setup.ts`. The only importer is `app/lib/db/triage.ts` (server-only); no
  `"use client"` file reaches it.
- RLS is enabled on all 7 `ticketing` tables; `anon` has no USAGE on the schema; no policy uses
  `using (true)`; no DELETE grant or policy anywhere; no views; no SECURITY DEFINER function in
  `public`.
- No path found by which a customer reads another customer's ticket, comment, event, or triage
  row, and no role self-escalation path (signup metadata ignored, `role`/`email` excluded from
  column grants, `admin_set_role` re-checks `is_admin()`).

### Warning

**W1. Customers can read the AI-derived working fields directly through the Data API; the "no
feedback loop" property is UI-only.** `20260903010000_tickets.sql:61` grants table-wide `SELECT`
on `tickets` to `authenticated`, and `tickets_select` admits the customer's own rows. Migration
070000 narrowed INSERT/UPDATE but left SELECT table-wide. The ticket page hides
`priority`/`category` from customers with the explicit rationale that showing them "would give
anyone probing the triage prompt an instant feedback loop", and `docs/ai-triage.md` states this
as a mitigation. Exploit: a customer obtains their own JWT, then `GET
/rest/v1/tickets?select=id,priority,category,team,triage_status` with `Accept-Profile: ticketing`
-- per submission, exactly what the model decided. Fix: move the fields to a staff-only table, or
column-level SELECT plus a staff accessor; correct the docs until enforced.

**W2. `consume_rate_limit` is a storage-growth vector for any authenticated user (shared free-tier
database).** EXECUTE is granted to `authenticated`; the body still takes `p_limit` and
`p_window_seconds` from the caller. The action whitelist fixes the key, but the primary key is
`(key, window_start)` and `window_start` is derived from the caller-chosen window, so every
distinct `p_window_seconds` in 1..86400 yields a fresh row per call. Fix: make limit/window a
fixed per-action lookup inside the function and drop the two parameters.

### Suggestion

- **S1** `admin_set_role` last-admin guard is racy: two admins demoting each other concurrently
  both read `count(*) = 2` and both succeed. Add `pg_advisory_xact_lock`.
- **S2** `guard_ticket_update` erases `resolved_at` on `resolved -> closed`. Only clear it when
  moving back to an open status.
- **S3** Re-running triage overwrites staff overrides and emits no event for the AI's change.
- **S4** CSP still allows inline scripts (known gap).
- **S5** Ticket text (often PII) goes to third-party model providers with no data-handling
  controls; add `provider.data_collection: "deny"` and document the flow.
- **S6** `URL_OR_EMAIL_RE` misses scheme-less domains (`evil.example/reset`); `missing_info` caps
  item count but not item length.
- **S7** Triggers on the shared `auth.users` can abort the other app's writes via the
  `lower(email)` unique index; wrap in `exception when unique_violation`.
- **S8** `app/lib/auth/clients.ts` has no `import "server-only"`; the comment in `service.ts`
  claims `clients.ts` exports a browser client (it no longer does).
- **S9** `supabase/config.toml` `schemas` omits `ticketing`; `max_rows = 1000` silently caps
  `getAdminStats`' `limit(5000)` so `sampled` never becomes true.
- **S10** `profiles.full_name` remains client-writable but unused; customers can comment on
  `closed` tickets; `tickets_insert_customer` does not check role (harmless; differs from the
  action's `requireRole("customer")`).
- **S11** Dashboard-only settings (min password length, confirmations, rate limits, redirect
  allow-list) should be confirmed; run `npx supabase migration list` to confirm 070000 is applied.

### Checked and found sound

- RLS/policy logic (cumulative state) for every table; deny-all on `rate_limits` and
  `ticket_embeddings`; column-level INSERT and UPDATE grants matching exactly what the app writes.
- DEFINER/INVOKER split correct; every function has `set search_path = ''` with fully qualified
  names; `match_tickets` executable by `service_role` only; explicit EXECUTE revoke/grant on the
  RPC-reachable set, which only ever reveals or acts on the caller's own row/bucket.
- Role model: `customer` hard-coded on signup and in `ensure_profile`; no `options.data`;
  `admin_set_role` re-checks `is_admin()`, refuses self-change, unassigns on demotion; role read
  from `profiles` per request. `guard_ticket_update` rejects non-staff assignees, immutable
  ticket text, transition map for everyone except admins (`service_role` included, so triage can
  never move status).
- Identity: `email` not client-writable, unique, synced from `auth.users`.
- Server actions: every action authorises first; UUIDs and enum values validated; `isInternal`
  forced false for customers; `rerunTriageAction` proves visibility through the caller's RLS and
  is rate-limited before any service-role write; `redirect()` never inside a `try`.
- Rate limits enforced by `BEFORE INSERT` triggers, so direct Data API inserts are limited
  identically.
- `/auth/confirm`: `safeNextPath` verified empirically against 32 inputs including
  `//evil.com`, `/\evil.com`, `\/evil.com`, `///evil.com`, whitespace-prefixed variants,
  `/..//evil.com`, same-origin URLs whose pathname is `//evil.com`, `host\@evil.com`,
  `javascript:`, CRLF, and percent-encoded forms -- all collapse to `/` or a same-origin
  single-slash path. `type` whitelisted; GET-only; OTP verification only.
- All mutations are Server Actions; cookies `httpOnly`/`secure`/`SameSite=Lax`; no browser
  Supabase client; `proxy.ts` has no role logic; CSP/HSTS/XFO/nosniff/Referrer/Permissions
  headers present.
- Prompt surface: `<`/`>` neutralised everywhere, candidates flattened and capped, strict schema
  with candidate ids as enums, TypeScript re-validation, foreign links and timeframe promises
  stripped from the draft, cost bounded. Output staff-only and advisory.
- Secrets hygiene: `.env*` (except `.env.example`), `.vercel`, `playwright/.auth`,
  `supabase/.temp` gitignored; no secret-shaped string in any tracked file.

### Comparison with audit #2

- Resolved: W1 (pathname rule present and empirically verified), W2 (column-level INSERT +
  pinned timestamps), W3 (`neutralizeTags`, `sanitizeCandidateText`, `stripForeignLinks`, draft
  caption), S1, S3, S4.
- Partially resolved: S2 -- whitelist and 24 h cap landed, but limit/window still caller-chosen
  (W2 here).
- Still open (documented gaps): S5 (`'unsafe-inline'`), S6 (dashboard settings), S7
  (`full_name`, raw sign-in error text, project ref in docs).
- Regressed: none.
- New: W1, S1, S2, S3, S5, S6, S7, S8, S9.
