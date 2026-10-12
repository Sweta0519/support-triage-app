# Security scan -- 2026-10-11

- **Date:** 2026-10-11
- **Tool:** the `/security-scan` command (`.claude/commands/security-scan.md`, sections 2 OWASP Top
  10, 4 API security, 5 secret detection, 6 headers, 9 report), run by a **fresh-context
  subagent** with no memory of earlier audits. The run was read-only: no edits, no external calls,
  no live-database access. It also ran `npm audit`.
- **Scope:** every Server Action and Route Handler, all page/layout guards, `proxy.ts`,
  `app/lib/auth/*`, `app/lib/db/*`, `app/lib/ai/*`, the Sage widget, the public share page, all 25
  migrations reduced to their cumulative effective state, `next.config.ts`,
  `supabase/config.toml`, `.gitignore`/`.env.example`, and every tracked file plus the full git
  history (81 commits) searched for secrets.
- **Branch / HEAD scanned:** `sup-11-security-scan` @ `4abb3fc`.

## Result

| Severity | Found | Fixed in this PR | Accepted / open |
|---|---|---|---|
| Critical | 0 | - | - |
| High | 1 | 1 (H-1) | - |
| Medium | 2 | 1 (M-1); M-2 mitigated 2026-10-12 | WAF rule for M-2 |
| Low | 3 | 1 (L-2); L-3 on 2026-10-12 | 1 (L-1) |
| Info | 8 | 3 (I-2, I-4, I-6) | 5 |

There are no Critical findings in the app's own code. The one High was the Next.js version.
**Production dependencies now have 0 known vulnerabilities** (`npm audit --omit=dev`).

## Fixes applied in this PR

| Finding | Fix | Where |
|---|---|---|
| **H-1** `next@16.3.4` has published advisories: npm rates it Critical for an RCE in `next/og`, which this app doesn't use, plus a High SSRF in Image Optimization and cache-poisoning issues | `next` and `eslint-config-next` patched to **16.3.8** (patch release; closes every Next.js advisory listed). Typecheck, lint, production build and the full test suite pass on it | `package.json`, `package-lock.json` |
| **I-2** transitive `sharp`, `brace-expansion`, `source-map-js` | `npm audit fix` (not `--force`), lockfile only | `package-lock.json` |
| **M-1** staff could insert any column into `shared_ticket_summaries` via the Data API: choose the public token, set `expires_at` years ahead (defeating the 30-day expiry) or backdate `created_at` | INSERT narrowed to the five columns the app writes (`ticket_id, published_by, subject, status, summary`); the token, expiry and timestamps always take their defaults. **Applied to the live database.** A regression test shows the forged insert is refused and a normal insert still works | migration `20261011010000_share_insert_columns.sql`, `tests/shareable-status-page.spec.ts` |
| **L-2** the AI `summary` (published on the public `/s/` page and shown to other tickets' triage as candidate text) wasn't link-stripped like the draft reply, so a prompt-injected ticket could plant a URL there | Every URL and email address is removed from `summary`, `priority_reason` and `missing_info` when triage runs. They're stripped **again at publish time**, together with the customer-written subject, so summaries stored before this change can't reach the public page with a link either. The helpers live in a plain module and have unit tests | `app/lib/ai/links.ts`, `app/lib/ai/triage.ts`, `app/(app)/tickets/actions.ts`, `tests/links.spec.ts` |
| **I-4** `in` checks on lookup objects accepted prototype keys (`?from=toString`) | `Object.hasOwn(...)` | `app/lib/queue-filters.ts`, `app/lib/queue.ts`, `app/(app)/admin/users/page.tsx`, `app/(app)/tickets/actions.ts` (`updateStatusAction`) |
| **I-6** `.playwright-mcp/` (screenshots and console logs of signed-in sessions) was untracked but not ignored | Added to `.gitignore` | `.gitignore` |

## Accepted or open

| Finding | Status |
|---|---|
| **M-2** no app-level throttling on sign-in / sign-up; this relies on Supabase Auth's built-in limits, which may see Vercel's IP rather than the visitor's (unverified) | **Mitigated 2026-10-12, SUP-13 (PR #35):** `ticketing.consume_auth_rate_limit()` (service-role only). Sign-in: every attempt is counted *before* the password check (parallel guesses can't slip past) and refunded unless it was a wrong password; 20 wrong passwords per 10 min per IP (IPv6 by /64), 10 per email *and* IP and 50 per email in 15 min. Keying the tight lock on email plus IP means a stranger can't lock someone else out. Sign-up: 5 per hour per IP, 3 per hour per email, refunded when Supabase sends no email. IP from Vercel's `x-forwarded-for`; emails only as an HMAC with a server-only secret; rows purged after a day. Fixed (clock-aligned) windows. Still open: the Vercel WAF rule (dashboard-only, see I-7; settings in `docs/security/vercel-waf.md`) and optional CAPTCHA on sign-up. |
| **L-1** `alter default privileges in schema ticketing revoke execute ... from public` has no effect, because per-schema defaults only *add* to the global ones | **Accepted, documented.** No live exposure: every callable function revokes PUBLIC EXECUTE explicitly, and the rest are trigger functions. A global `alter default privileges for role postgres` would also affect `notes-collections`, which shares this database, so the rule stays: **every new function must revoke PUBLIC EXECUTE itself** |
| **L-3** account deletion needs only the typed email, with no re-authentication | **Fixed 2026-10-12, SUP-14:** deletion also requires the current password, checked against Supabase Auth with a throwaway client that keeps no session (`verifyOwnPassword` in `app/lib/db/account.ts`) and throttled with the sign-in limiter, so the form can't be used to guess passwords |
| **I-1** CSP `script-src 'unsafe-inline'` | Accepted, as in audits 2-4. There's no `dangerouslySetInnerHTML`, `react-markdown` renders no raw HTML, and the `img-src` restriction blocks beacon exfiltration |
| **I-3** sequential ticket numbers let a customer infer overall ticket volume | Accepted: the numbers aren't used for any lookup or authorisation outside the RLS-scoped queue. (The comment in `20261011000000_ticket_numbers.sql` listing `priority, category, team` as UPDATE-granted is stale; it's left unedited because the migration is already applied) |
| **I-5** `x-forwarded-for` trusted by the public-share limiter | Accepted: Vercel sets the header at the edge |
| **I-7** dashboard-only settings (hosted Auth password and rate limits, Vercel WAF rule) can't be verified from the repo | Accepted, as in audit-4 |
| **I-8** `sendMessageAction` has no runtime type check on its argument | Accepted: `requireStaff()` runs first; worst case is a 500 |
| Dev-only advisories still reported by `npm audit` (`eslint-config-next` -> `fast-glob` -> `micromatch` -> `braces`) | Accepted: lint toolchain only, never shipped, no fixed version published |

## Verified secure (summary of the scan)

- **Authorisation:** every exported Server Action authorises first (`requireRole` /
  `requireStaff` / `requireAdmin` / `requireProfile`), except sign-up, sign-in and sign-out, which
  are public by design. IDs are validated with `isUuid`, and enums against closed sets. Every
  `(app)` page and layout is guarded; `/admin/*` and `/analytics` are admin-only.
- **`proxy.ts`:** it only refreshes the session and redirects signed-out visitors. There's no role
  logic in it.
- **Roles:**
  - The role is read fresh from `ticketing.profiles` via `ensure_profile()`.
  - `authenticated` has no UPDATE on `profiles`.
  - `admin_set_role()` is the only write path, with an advisory lock, no self-change and a
    last-admin guard.
- **IDOR:** customer reads also filter on `customer_id`. Service-role writes run only after
  `getTicketForStaff()`. Deletion and export take the user ID from the session.
- **CSRF:** every mutation is a Server Action with pinned `allowedOrigins`. The only Route Handlers
  are GET-only.
- **Redirects:** `safeNextPath()` resolves against `NEXT_PUBLIC_SITE_URL`, and email links are
  built from it.
- **No SSRF or XSS sinks:** the only outbound fetch goes to the fixed OpenRouter URL, and there is
  no `dangerouslySetInnerHTML`.
- **Database:**
  - RLS is enabled on all 13 `ticketing` tables, with no `true` policies and no grants to `anon`.
  - INSERT and UPDATE are column-scoped on `tickets`, `ticket_comments`, `notes` and now
    `shared_ticket_summaries`.
  - `guard_ticket_update` enforces immutable fields and the status-transition map.
  - Every SECURITY DEFINER function has `search_path = ''` and an explicit `auth.uid()` or role
    check.
- **Newest migrations:**
  - `review_triage()` (2026-10-09) checks for a stale run and a concurrent review under a row lock.
  - The ticket-numbers migration (2026-10-11) is sound, and clients can't write the number.
- **Concurrency:** claiming is a conditional `UPDATE ... WHERE assignee_id IS NULL`, never
  read-then-write.
- **Rate limits:**
  - Ticket and comment limits are enforced in BEFORE INSERT triggers.
  - Triage re-runs, Sage messages and note saves are checked before any paid call.
  - The public share page has its own IP-keyed limiter.
- **Service-role key:** it lives only in `app/lib/supabase/service.ts` (`server-only`). Its
  importers are `triage.ts`, `shares.ts` and `account.ts` (all server-only), and no client
  component can reach it.
- **AI:**
  - `OPENROUTER_API_KEY` is server-only.
  - Untrusted ticket text is delimited, and `<`/`>` are neutralised.
  - Output uses `json_schema` with `strict: true`, and duplicate and related ticket IDs are
    restricted by enum to the candidate list computed on the server.
  - Triage never writes `tickets.status` and never sends a reply.
  - OpenRouter calls use `data_collection: "deny"`.
- **Sage:** `match_documents()` has no user-ID parameter and filters on `auth.uid()` under RLS.
  Tool rounds and history are capped.
- **Headers and cookies:**
  - The CSP has `frame-ancestors 'none'`, `object-src 'none'`, and `base-uri` / `form-action` set
    to self.
  - HSTS includes `preload`, and `X-Frame-Options`, `nosniff`, `Referrer-Policy` and
    `Permissions-Policy` are all set.
  - Session cookies are `httpOnly`, `SameSite=Lax`, and `secure` in production.
- **Secrets:** no hits across tracked files or the full git history for `sk-`, `sk-or-v1-`, JWTs,
  `service_role`, key assignments or `password=`. `.env*` is ignored apart from `.env.example`,
  which holds no values.

## Comparison with audit-4 (2026-09-04)

- **Audit-4 items:** all fixed or still accepted as before (CSP `unsafe-inline`, dashboard-only
  settings).
- **Corrected:**
  - Audit-4's claim that `alter default privileges` meant "nothing is publicly callable by accident"
    was wrong (L-1). There's no live exposure.
  - The service client now has three importers instead of one; the other two are justified and
    documented.
- **New since audit-4:** H-1 (the Next.js advisories were published after it), M-1 (the share
  grant dates from the share feature but wasn't caught then), M-2, L-2, L-3, and the minor I-3,
  I-4, I-6, I-8.
- **Newly checked and sound:**
  - Sage and notes RAG scoping, `save_note`, `export_own_data`, and the last-admin delete guard
  - all three `review_triage` migrations and the ticket-numbers migration
  - the SLA and analytics pages, and the queue search
- **Regressions:** none.
