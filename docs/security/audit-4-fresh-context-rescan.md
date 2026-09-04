# Security audit #4 -- fresh-context rescan

- Date: 2026-09-04
- Tool: `security-auditor` subagent started as a **new agent with no memory of audits #1-#3 or
  of the fixes**, instructed to re-examine every file and migration from scratch and only consult
  `audit-3-fresh-context-rescan.md` at the very end for the comparison section
- Scope: all 11 migrations reduced to their cumulative effective state; every file under `app/`,
  `proxy.ts`, `next.config.ts`, `supabase/config.toml`, `.gitignore`/`.env.example`/`.env.local`
  (names only), `tests/`, `docs/`
- Result: **0 Critical, 0 Warning, 6 Suggestion** -- every prior Critical/Warning across all four
  audits confirmed resolved, no regressions. This is the clean fresh-context rescan required
  before merging.

> "Bottom line: this is a mature, previously-audited codebase with all prior Critical/Warning
> findings closed and no new Critical or Warning issues found in this fresh pass. Remaining items
> are cosmetic/documentation-level." -- audit #4

## Fixes applied

| Finding | Fix | Where |
|---|---|---|
| Stale "computed over the most recent 5,000 rows" string after `MAX_ROWS` was corrected to `1_000` in the audit-3 fix (S9) | `MAX_ROWS` exported from `admin.ts`; the admin page now interpolates the real constant | `app/lib/db/admin.ts`, `app/(app)/admin/page.tsx` |
| `sync_profile_email`/`handle_new_user` silently swallowed `unique_violation` on the shared `auth.users` triggers -- correct to never abort the other app's write, but left no trace if it ever happened | `raise warning` with the email and `auth.users` id, still non-fatal | migration `20260904000000_audit4_suggestions.sql` |
| HSTS header had no `preload` directive | Added | `next.config.ts` |
| CSP `script-src 'unsafe-inline'`; dashboard-only Auth settings; project ref named in docs | Left as documented, accepted gaps (same as audits #2/#3) | -- |
| "Re-run overwrites staff overrides" (audit #3 S3) | Still not applicable -- no staff-override UI exists for the working state | -- |

## Report (verbatim)

### Critical

None found.

- `SUPABASE_SERVICE_ROLE_KEY` and `OPENROUTER_API_KEY` are read only in `app/lib/supabase/service.ts`
  and `app/lib/ai/openrouter.ts` (both `server-only`); the only importer of the service client is
  `app/lib/db/triage.ts`, plus `tests/reset.setup.ts` for test-data hygiene. No `NEXT_PUBLIC_`
  variable holds anything but the URL/anon key/site URL.
- RLS enabled on all 8 `ticketing` tables; `anon` has no `USAGE` on the schema; no policy uses
  `using (true)`; no view or `SECURITY DEFINER` function in `public`.
- No path lets a customer read another customer's ticket, comment, event, triage result, or
  AI-derived working state.

### Warning

None found. Every warning-class item from audits #1-#3 (Data-API-visible triage fields,
`consume_rate_limit` storage-growth via caller-chosen window, and others) is fixed in the current
migration set.

### Suggestion

- Stale "5,000 rows" UI string vs. the corrected `MAX_ROWS = 1_000` constant (cosmetic, not a
  data-exposure bug -- `sampled` itself was computed correctly).
- CSP `script-src 'unsafe-inline'` (documented, accepted gap since audit #2/#3).
- `sync_profile_email`/`handle_new_user` swallow `unique_violation` with a bare `null;` -- correct
  behaviour, but silent; recommend a log line.
- `docs/supabase-schema.md` names the real Supabase project ref in prose -- not a secret (derivable
  from the public URL), but no reason to spell it out.
- Dashboard-only settings (Auth rate limits, min password length, email confirmation, redirect
  allow-list) remain unverifiable from code -- recommend confirming in the dashboard, since a wide
  redirect allow-list would undermine `safeNextPath()`.
- HSTS header had no `preload` directive.

### Checked and found sound

- RLS policy logic, cumulative state, every table: `profiles`, `tickets`, `ticket_comments`,
  `ticket_events`, `rate_limits`, `triage_results`, `ticket_triage_state`, `ticket_embeddings`.
  USING/WITH CHECK symmetric on `tickets_update_staff`, which is what makes ticket claiming
  race-free.
- SECURITY DEFINER vs INVOKER split correct everywhere, each with a documented reason; every
  DEFINER function has `set search_path = ''` with fully qualified names.
- Grants are minimum-need and column-restricted everywhere a client needs only a subset;
  `alter default privileges` plus explicit per-function EXECUTE grants mean nothing is publicly
  callable by accident; `match_tickets()` is `service_role`-only.
- Role model: hard-coded `customer` on signup, `admin_set_role()` is the only write path
  (RPC + column exclusion), re-checks `is_admin()`, refuses self-demotion and last-admin
  demotion, serializes concurrent calls with an advisory lock, unassigns a demoted staff
  member's tickets. Role read fresh per request, never cached in a JWT claim.
- Identity spoofing: `email` unique, synced from `auth.users`, not client-writable; `full_name`
  likewise not writable.
- Ticket-claiming/assignment race: a single conditional `UPDATE`, matched by a symmetric RLS
  policy -- Postgres serializes it, no read-then-write gap.
- Rate limiting: `consume_rate_limit(p_action)` takes only an action name from a hardcoded
  whitelist; insert limits enforced by `BEFORE INSERT` triggers, so a direct Data API POST is
  limited identically to the app.
- Server actions: every action authorises first, validates ids/enums, computes `isInternal`
  server-side; `redirect()` never inside a `try`; `rerunTriageAction` proves visibility via the
  caller's RLS before any service-role write.
- `/auth/confirm`: `safeNextPath()` resolves against `NEXT_PUBLIC_SITE_URL`, rejects cross-origin,
  and rejects a same-origin pathname starting with `//`; `type` whitelisted; GET-only.
- CSRF: all mutations are Server Actions with `allowedOrigins` pinned; no other mutating Route
  Handler exists.
- Cookies `httpOnly`/`secure`/`SameSite=Lax`; no browser Supabase client anywhere; CSP/HSTS/XFO/
  nosniff/Referrer/Permissions headers present.
- `proxy.ts`: session refresh and "signed in at all" only, explicitly not an authorization layer.
- AI/prompt-injection surface: delimiters tag-neutralised, candidate ids enum-constrained,
  strict JSON schema plus TypeScript re-validation, foreign links and timeframe promises
  stripped from the draft, cost bounded, `data_collection: "deny"`. All output staff-only and
  advisory.
- The specific concern this whole audit chain kept returning to -- a customer reading their own
  ticket's AI-derived priority/category to tune an injection -- is closed **structurally**: those
  columns don't exist on any row a customer can `SELECT`. Confirmed by RLS definition and by
  `tests/ai-triage.spec.ts` asserting the panel never renders for the customer even after polling
  past completion.

### Comparison with audit #3

Resolved: both audit-3 Warnings (customer-readable AI fields via Data API; rate-limit
storage-growth) and Suggestions S1, S2, S7, S8, S9, S10. Still open (documented, accepted):
S4 (CSP), S11/S6 (dashboard settings). Not applicable: S3 (no staff-override UI exists yet).
Regressed: none. New: the stale "5,000 rows" string (a leftover of the S9 fix, not previously
called out) and the project-ref note -- both cosmetic.
