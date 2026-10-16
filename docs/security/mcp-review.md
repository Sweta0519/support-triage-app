# Security review: the MCP connector (epic SUP-47)

A review of the whole connector as merged: personal access tokens (SUP-53, PR #65), the endpoint
(SUP-54, PR #67), the customer and staff tools (SUP-55, PR #68; SUP-56, PR #71), and the setup
UI (SUP-65, SUP-66, PRs #69 and #70). How it works is in `docs/mcp.md`. This page checks it
against the risks SUP-57 lists, each with where the evidence is. Each of those PRs also had the
two reviews `docs/reviews/README.md` describes, with every finding answered inline on the PR.

## Tokens: entropy and storage

- **Entropy.** The secret is 32 random bytes from Postgres's `gen_random_bytes` (256 bits),
  written `st_` + base64url. It's generated in the database by
  `ticketing.create_access_token()`, so a client can't choose a weak one. Users have no INSERT
  grant on the table (`20261015020000_access_tokens_create_rpc.sql`).
- **Storage.** Only the SHA-256 hash and an 11-character prefix are stored. A fast unsalted hash
  is right for a 256-bit random secret: there's nothing to guess. It also lets a token be looked
  up by its unique hash index.
- **Shown once.** The secret is returned once, to the Account page that created it. It's never
  stored client-side, never put in a URL, and gone after "Done" or a reload. Only the "Created"
  line is a live region, so screen readers don't read the token aloud
  (`tests/access-tokens.spec.ts`).
- **Hash never readable.** Owners can read their tokens' name, prefix and dates, but there's no
  column grant on `token_hash`, and other users see nothing. Only the service role can resolve a
  hash (`resolve_access_token()`).
- **Limits.** At most 10 active tokens per person, enforced by a trigger under a per-owner
  advisory lock, so concurrent creates can't exceed it. Creation is rate-limited to 10 an hour.
  Tokens expire after 30, 90 or 365 days, or never (the owner's choice), and revoking is
  immediate.
- **Account deletion** removes the tokens (`on delete cascade`). The data export lists them
  without hashes.

## Signing a request in

- **Every request** re-resolves the bearer token. A revoked or expired token, or a deleted
  account, is refused on the next call: `401` with `WWW-Authenticate: Bearer`. Malformed tokens
  are refused without a database call.
- **As the owner, never as the service role.** The owner gets a real Supabase session
  (a one-time sign-in link exchanged server-side). The request then runs inside
  `runWithUserSession()`, so every `app/lib/db/` function runs under the owner's RLS. The service
  role is used to resolve the hash and start that session, and for the background triage run
  that `create_ticket` starts, as the web form does. Owners who are gone or unconfirmed get
  `401`.
- **How fast it applies:** revoking, expiry and deleting the account apply on the next request.
  A ban or a sign-out everywhere applies within 5 minutes, when the cached session is next
  renewed (`SESSION_REUSE_SECONDS`).
- **The role is read on every request** from `ticketing.profiles` (after `ensure_profile()`),
  never from a JWT claim. The tool set is built from it, so a demoted agent loses the staff tools
  on the next call (`tests/mcp.spec.ts`). Only `agent` and `admin` get staff tools.
- **Known trade-off:** a new sign-in adds a session, and may replace a pending sign-in link for
  that user (not verified against Supabase Auth's source). It's documented in `docs/mcp.md`, with
  the fix it would take.

## Rate limits

| What | Limit | Where |
|---|---|---|
| Creating tokens | 10 an hour per person | `access_token` in `consume_rate_limit()` |
| MCP requests | 120 per fixed 10-minute window per person (all their tokens; a burst across a window boundary can reach about twice that) | `mcp_request`, answered with `429` and `Retry-After` |
| Filing tickets, replies | The web app's own limits | The same insert triggers (`create_ticket`, `add_comment`) |
| Unknown tokens | Not counted by the app (one indexed lookup each) | Vercel firewall rule: 30 POSTs per minute per IP (`docs/security/vercel-waf.md`, confirmed 2026-10-16) |

Unknown tokens aren't throttled per IP in the app on purpose: hosted MCP clients share
addresses, so one abuser could block everyone using that client. The Vercel rule does limit per
IP, coarsely (30 POSTs a minute across the whole app). That was accepted in SUP-74, because the
clients the app supports call from the user's own machine (`vercel-waf.md`, "Trade-off").

## RLS coverage, tool by tool

Every tool reads and writes through `app/lib/db/` as the owner, so the same RLS policies as the
web app apply. The one service-role use is the background triage run that `create_ticket` starts,
exactly as the web form does (it reads that one ticket and writes only its triage).

| Tool | Who | What decides visibility | Tested in |
|---|---|---|---|
| `whoami` | everyone | Own profile | `mcp.spec.ts` |
| `create_ticket`, `list_my_tickets`, `get_ticket`, `add_reply` | customers | `customer_id = auth.uid()` (RLS plus an explicit filter). Someone else's ticket reads as "you don't have it". Never triage or internal notes. | `mcp-customer-tools.spec.ts` |
| `list_queue`, `get_ticket`, `claim_ticket`, `post_reply`, `set_status`, `review_triage` | agents, admins | `tickets_select`: agents see their own and unassigned tickets, admins all. Related-ticket links only show numbers the caller can see. | `mcp-staff-tools.spec.ts` |

- **Writes keep the web app's rules.** The claim is the conditional
  `UPDATE … WHERE assignee_id IS NULL`, tested with a concurrent race. Status moves use the
  board's transition map, for admins too.
- **Reviews are checked against what was read.** The assessment and review time from
  `get_ticket` must come back, so a newer AI run or someone else's review is refused.
- **Triage stays advisory.** No tool changes status by itself or sends the AI's draft. The draft
  comes back marked `suggestion_only`, and only `post_reply`, an explicit staff action, reaches a
  customer (tested: claiming, reviewing and moving post nothing).

## Prompt injection through ticket text

The assistant on the other end is a language model, and tickets are written by anyone.

- **Results are JSON,** so a ticket's text can't break out of its field.
- **Every human- or model-written field is wrapped** as `{"untrusted_text": …}`: subjects,
  descriptions, replies and notes, AI summaries and reasons, the draft reply, what's still
  needed, other people's display names, and label names. (`whoami` returns your own
  name as is.)
- **The server's instructions** (`app/lib/mcp/server.ts`) tell the assistant to treat wrapped
  text as information, never as instructions.
- **The tools limit the damage** if an assistant is fooled anyway. It can only do what the person
  could do in the web app, every write is an explicit tool call the client shows, and replies to
  customers are never automatic.

## CSRF and browsers

`/api/mcp` is the app's one mutating Route Handler. It never reads cookies: a request signs in
only through the `Authorization` header, which browsers don't attach on their own, so a web
session can't be ridden (tested: cookie-only requests get `401`). It sends no CORS headers, so
another site's page can't call it with a token either (tested: the preflight has no
`Access-Control-*`). The proxy skips exactly `/api/mcp`. CLAUDE.md records this exception.

## Logging

- **What's logged:** our-side failures (database or Auth errors) in the route and in tool
  handlers, through `guarded()`, plus the owner's user id when a session refresh fails.
- **What isn't:** no token, token hash, JWT or refresh token is passed to any log call or error
  message. This is checked by reading every log call (`route.ts`, `results.ts`, `mcp-auth.ts`),
  not by a test.
- **What callers see:** errors they get never include the underlying message: a tool failure is
  "a problem on our side", and the route answers `503`.

## Open items

- OAuth sign-in, needed for ChatGPT's and the Claude apps' connectors, isn't supported. It would
  also remove the sign-in-link side effect.
- Whether a new MCP sign-in really replaces a pending sign-in link (above) is unverified.

## Closed since the review

- **The Vercel firewall rule** was confirmed live on 2026-10-16 (SUP-74). There is one rule for
  every POST, 30 per minute per IP, which also covers `/api/mcp`.
