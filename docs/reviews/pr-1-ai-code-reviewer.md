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

See the appended section below, added after the audit-2 fixes were committed.
