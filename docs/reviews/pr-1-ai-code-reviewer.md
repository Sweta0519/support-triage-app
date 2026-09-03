# `ai-code-reviewer` report -- PR #1 (`feature/m7-readme-security-tests` -> `main`)

- Date: 2026-09-03, recorded **before merge**
- Tool: `ai-code-reviewer` subagent (read-only) over `git diff main...feature/m7-readme-security-tests`
  at commit `f61026d` (README/tests/CSP, prompt tweak, audit-1 fixes, screenshot regen), plus the
  surrounding pre-existing code needed to judge each change
- Result: **0 blocking, 2 should-fix, 2 nits** -- all addressed in the same PR before merge

## Actions taken

| # | Finding | Resolution |
|---|---|---|
| 1 | `README.md` "Docs" section referenced `docs/security/` rescan and `docs/reviews/` reports that did not exist yet | Both now exist: `docs/security/audit-2-fresh-context-rescan.md`, `docs/security/audit-3-fresh-context-rescan.md`, and this file |
| 2 | Stale comment on `listProfiles()` described the pre-fix `profiles_select_staff` policy | Comment rewritten: admins see every row, agents staff rows only, customers their own |
| 3 | `login()` helper duplicated across five spec files | Extracted to `tests/helpers.ts` (with `requireEnv()`); all specs import it |
| 4 | `alter default privileges` only affects future functions; existing ones kept PUBLIC EXECUTE (matched the audit-1 finding's wording, but implicit) | Superseded: migration `20260903070000_audit2_fixes.sql` revokes PUBLIC EXECUTE explicitly on every existing callable function and grants `authenticated`/`service_role` |

Changes made after this review (audit-2 fixes in `20260903070000_audit2_fixes.sql`, the
`//`-pathname redirect fix, tag neutralisation and link stripping in `triage.ts`, customer-only
ticket creation, `.maybeSingle()`) are covered by the second reviewer pass recorded below.

## Report (verbatim)

### Should fix

1. **`README.md` (new "Docs" section) -- references two artifacts that don't exist.** It claims
   `docs/security/` contains "initial scan, fixes, fresh-context rescan" and that `docs/reviews/`
   holds an "`ai-code-reviewer` report recorded before merging the PR." Only
   `docs/security/audit-1-initial.md` and `docs/security/pr-1-diff-review.md` exist;
   `docs/reviews/` doesn't exist at all. `audit-1-initial.md` itself also promises a follow-up
   `audit-2-fresh-context-rescan.md` that was never created. Since `CLAUDE.md` requires running
   the `ai-code-reviewer` subagent and recording it before merge, this isn't just a typo -- it
   reads as claiming a required step happened when the artifact isn't in the repo.

2. **`app/lib/db/profiles.ts:22-23` -- stale comment after the S4 RLS fix.** The comment described
   the old `profiles_select_staff` policy. After `20260903060000_audit_fixes.sql`, agents only see
   staff rows; only admins see every profile. `listProfiles()` is only called from the admin-gated
   `/admin/users` page, so no behavioural bug -- but the comment misdescribes the policy.

### Nits

3. `tests/role-matrix.spec.ts` duplicates the `login()` helper already present in
   `tests/cross-user-security.spec.ts`. Low priority -- spec files often stay self-contained.

4. `20260903060000_audit_fixes.sql` (S2 fix) only prevents *future* functions from getting
   `PUBLIC EXECUTE`; it does not retroactively revoke it on functions from earlier migrations.
   Matches what the audit finding asked for and calls "benign today"; worth stating explicitly.

### What I checked and found sound

- Migration <-> TypeScript constants match: `SUBJECT_MAX_LENGTH`/`BODY_MAX_LENGTH`/
  `COMMENT_MAX_LENGTH` (200/20000/10000) equal the CHECK constraints; rate-limit numbers
  (10/3600, 30/600, 5/600) match between the DB triggers and the actions.
- Rate-limit error plumbing: `checkRateLimit`/`RateLimitError` still used for `rerun_triage`, so
  not dead code; the `rate_limited` substring checks map each trigger exception to the right
  `RateLimitError(action)`.
- Column-grant fix (W6): `grant update (status, assignee_id, priority, category, team)` covers
  exactly the columns `claimTicket`/`assignTicket`/`updateTicketStatus` set; triage writes go
  through the service role and bypass grants.
- `guard_ticket_update`'s internal writes to `resolved_at`/`closed_at`/`ticket_events` aren't
  blocked by the tightened grant -- column-privilege checks apply to the client's SET list, not
  trigger-internal `NEW` mutations.
- `resetTriageStatus` staleness logic: `updated_at` is bumped by `set_updated_at()` on every
  update including the `pending -> processing` claim, so the 5-minute check is sound.
- `ticket_events` (W2) and `profiles_select_staff` (S4) policies use the existing helpers with
  correct signatures.
- `profiles.email` sync trigger (W3): `SECURITY DEFINER`, `search_path = ''`, fully qualified,
  named `..._ticketing` to avoid colliding on the shared `auth.users`; harmless for
  notes-collections-only users.
- Auth confirm redirect fix (W8): resolves against `NEXT_PUBLIC_SITE_URL` and compares origins,
  never trusting `Origin`/`Host`.
- Cookie hardening (S1): `createBrowserSupabaseClient` removed with no remaining callers;
  `AUTH_COOKIE_OPTIONS` shared between `clients.ts` and `proxy.ts`.
- CSP/headers (S3): scoped to the finding; `unsafe-eval` dev-only; no nonce infra added (a
  documented gap rather than a silent skip).
- Prompt-injection hardening (W5) and customer-visibility fix (W4) are additive/restrictive
  only, consistent with `docs/ai-triage.md`.
- No new npm packages, no secrets in source, no `customer_id` scoping removed anywhere -- every
  `db/*.ts` query still filters explicitly in addition to RLS, per convention.

## Second reviewer pass (final PR state)

- Scope: `git diff f61026d` (everything after the first pass -- the audit-2 fixes, test helper
  refactor, docs) plus the full diff against `main`
- Result: **1 blocking, 2 should-fix, 3 nits** -- all addressed before merge

### Actions taken

| # | Finding | Resolution |
|---|---|---|
| 1 | Blocking: `audit-2-fresh-context-rescan.md` and this file referenced `audit-3-fresh-context-rescan.md` before it existed | Audit #3 was already running as a fresh agent when this review landed; its report is recorded at `docs/security/audit-3-fresh-context-rescan.md` before merge |
| 2 | Should fix: `requireRole("customer")` gates ticket creation in the app, but `tickets_insert_customer` never checked the caller's role -- an agent/admin could still `POST /rest/v1/tickets` directly | Migration `20260903080000_customer_only_insert.sql`: the policy now requires `(select ticketing.app_role()) = 'customer'` |
| 3 | Should fix: no test for the reverse role boundary (staff -> `/tickets`, `/tickets/new`) | Added "staff are bounced from the customer ticket pages" to `tests/role-matrix.spec.ts` |
| 4 | Nit: `URL_OR_EMAIL_RE` swallows trailing punctuation, so a link that appears in the ticket could still be replaced in the reply (fails safe, over-strips) | Compare with trailing punctuation stripped on both sides; keep the punctuation in the replacement |
| 5 | Nit: the redirect comment named the wrong case (the `//evil.example` forms are already caught by the origin check; the pathname rule is for a *same-origin* URL whose pathname starts with `//`) | Comment rewritten to describe the actual case |
| 6 | Nit: `service_role` EXECUTE grants on the helper functions are probably not load-bearing (the triage code only calls `match_tickets`) | Left in place -- harmless and explicit; noted here |

### Report (verbatim)

**Blocking**

1. `docs/security/audit-2-fresh-context-rescan.md:14` and `docs/reviews/pr-1-ai-code-reviewer.md:13`
   both assert that a third audit, `docs/security/audit-3-fresh-context-rescan.md`, was run and
   "now exists," but that file does not exist anywhere in the repo. This is the exact defect
   class the first-pass review already flagged -- it has recurred, this time inside the audit
   trail itself. Fix: produce the file before merging, or remove the references.

**Should fix**

2. RLS gap behind the new `requireRole("customer")` checks -- `tickets_insert_customer`
   (`20260903010000_tickets.sql:84-95`) only checks `customer_id = auth.uid()` and the row's
   pristine state; it never checks the caller's role. An authenticated agent or admin can still
   `POST /rest/v1/tickets` directly and create a ticket for themselves, bypassing the Server
   Action's gate. The very next fix in the same migration (W2, column-level INSERT grants) exists
   precisely because a direct REST POST is a recognised attack surface here. Suggest adding
   `and ticketing.app_role() = 'customer'` to the `WITH CHECK` clause.

3. Missing test coverage for the new route restriction -- `tests/role-matrix.spec.ts` has "a
   customer is bounced from the staff queue" but nothing for the reverse: staff hitting `/tickets`
   or `/tickets/new` now get `/403`. A genuine, intentional behaviour change that should get the
   same assertion.

**Nits**

4. `app/lib/ai/triage.ts` (`stripForeignLinks`/`URL_OR_EMAIL_RE`) -- the regex can swallow
   trailing punctuation: `"...http://good.example/ticket/123, thanks"` matches with the comma
   included when building the "allowed" set, so the same URL without the comma in the reply is
   replaced with `[link removed]`. Fails safe; reduces usefulness.
5. `app/auth/confirm/route.ts:18-23` comment -- the two literal examples it names are already
   caught by the origin check; the added pathname rule is needed for a *same-origin* absolute URL
   whose pathname starts with `//`. The fix and regex are correct; only the framing is off.
6. `20260903070000_audit2_fixes.sql:44-50` grants EXECUTE on the helpers to `service_role`; the
   only direct service-role RPC is `match_tickets`, so this is likely harmless but possibly
   unnecessary.

**What I checked and found sound**

- Column-level INSERT grants match exactly what `createTicket()`/`addComment()` insert.
- `consume_rate_limit`'s whitelist covers exactly the three call sites.
- `.maybeSingle()` in `assignTicket`/`updateTicketStatus`: both callers ignore the return and
  revalidate, matching `claimTicket` -- closes a real RLS-hidden-row -> 500 bug, no regression.
- `handle_new_user`/`ensure_profile` null-email guards consistent with each other and CLAUDE.md.
- Open-redirect fix verified with concrete repros for `//evil.example`, `/\evil.example`,
  `https://site//evil.example`, `/tickets`.
- `neutralizeTags` applied to both injection surfaces (current ticket and candidates).
- `tsc --noEmit` and `eslint` clean; no leftovers from extracting `login()`/`requireEnv()`.
- `requireProfile()` still has legitimate callers. Docs accurately reflect the new grants and
  mitigations. No new npm packages, no secrets in source, no custom auth logic.
