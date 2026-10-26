# Email intake (epic SUP-80)

Support teams get most of their tickets by email. Each workspace has its own inbound address;
a team forwards its existing support mailbox to it, and every email becomes a ticket or a
comment on one. Staff replies go back to the customer by email, in the same thread.

| Part | Issue | What |
|---|---|---|
| 1 | SUP-88 | Inbound address per workspace, signed webhook endpoint, this decision record |
| 2 | SUP-89 | An email becomes a ticket or a comment; quoted text, loops and bounces |
| 3 | SUP-90 | Staff replies are sent by email in the thread |
| 4 | SUP-91 | Admin page shows the address; schema doc, README, homepage copy |

## Provider: Resend

Chosen on 2026-10-26 (user decision):

- One provider for receiving and sending.
- Webhooks are signed (Svix HMAC-SHA256), so a delivery can be verified with `node:crypto`. No
  npm package is needed: the API is called with `fetch`.
- An EU region is available.
- Attachments are **rejected** for now. They're dropped, and the ticket notes how many there
  were (SUP-89).

**No domain yet.** Until one is bought, mail is received at the Resend account's own
`<id>.resend.app` subdomain, where any local part is accepted. A workspace's address is
`<inbound_address>@<EMAIL_INBOUND_DOMAIN>`, for example `in-3f9a0c1b2d4e@abc123.resend.app`.
Without a verified sending domain, Resend delivers outbound mail only to the account owner's
own address, which is enough for the demo (SUP-90).

## Configuration

Server-only variables in `.env.local` and in Vercel (never `NEXT_PUBLIC_`):

| Variable | Where it comes from |
|---|---|
| `RESEND_API_KEY` | Resend → API Keys. Fetches received emails (SUP-89) and sends replies (SUP-90). |
| `RESEND_WEBHOOK_SECRET` | Resend → Webhooks → the `email.received` webhook's signing secret (`whsec_…`). |
| `EMAIL_INBOUND_DOMAIN` | The receiving domain, `<id>.resend.app` for now. |

In Resend, add a webhook for the `email.received` event pointing at
`https://<site>/api/email/inbound`. Without both the secret and the domain, the endpoint
answers 503 and records nothing.

## The webhook: `POST /api/email/inbound`

`CLAUDE.md` says state-changing operations go through Server Actions for their CSRF check, and
that a plain mutating Route Handler needs a fresh look. This is that look, the same shape as
the one for `/api/mcp` (`docs/mcp.md`).

**Why it is safe without the Server Action CSRF check.** CSRF works by making a signed-in
browser send a request that carries its cookies. This endpoint never reads cookies and has no
signed-in user. The only thing that lets a request in is a valid signature made with
`RESEND_WEBHOOK_SECRET`, which only Resend and this server hold. A browser can't produce it, and
the endpoint sends no CORS headers. The proxy doesn't run for this path (`proxy.ts`), so there's
no session refresh or redirect either.

**What it checks, in order:**

1. The secret and the domain are configured, or 503.
2. The body is at most 64 KB, or 413. The event carries only metadata, so anything bigger
   isn't from Resend. The body is read in chunks and abandoned at the limit, so a large request
   is never buffered whole.
3. The signature (`app/lib/email/webhook-signature.ts`), or 401:
   - `svix-id`, `svix-timestamp` and `svix-signature` are all present;
   - the timestamp is within **5 minutes** of the server's clock, so a captured request can't be
     replayed later;
   - one of the `v1,<base64>` entries equals the HMAC-SHA256 of `<id>.<timestamp>.<raw body>`,
     compared in constant time. A space-separated list is accepted, for secret rotation.
4. A signed event of another type is acknowledged with 200 and ignored. A signed body that isn't
   a JSON object, has no `email_id`, or has an id longer than 100 characters gets 400: a final
   answer, because a retry could never succeed.
5. The delivery is recorded by `ticketing.record_inbound_email_event()`. It runs with the
   service role, because there's no user.

**The workspace comes from the address, never from the request.** The route passes only the
local parts of recipients at `EMAIL_INBOUND_DOMAIN` (from `to`, `cc` and the envelope's
`received_for`, because a forwarded email's `To` is usually the team's own address). The
function matches them against `workspaces.inbound_address`:

| Match | Outcome | Response |
|---|---|---|
| this `svix-id` (a retry) or this email (`email_id`, sent again under a new `svix-id`) already recorded | `duplicate`, nothing changes | 200 |
| one or more workspaces | `received`, one row for each workspace | 200 |
| a workspace whose 300 emails this hour are used up | `held` (reason `rate_limited`) for that workspace | 200 |
| none | `ignored`, reason `unknown_address` (only the first 1000 an hour are recorded) | 200 |

An email to two workspaces (a customer who cc's two teams) gets a row in each, and each
workspace files it in its own queue (SUP-89). Each row belongs to exactly one workspace, so
nothing is shared between them, and the sender already chose to send the email to both.

Over the cap, mail is **held**, not refused. Resend's retries follow a fixed schedule for about
a day, so refusing with 429 during a long flood could drop a real email with no trace of it. A
held row is visible to the workspace's admins and is filed once the flood is over (SUP-89). Only
a 503 (our database is down) is left to Resend to retry.

The cap is counted after the insert, only for rows actually inserted, so a duplicate or a
concurrent retry never uses it up.

The inbound address is random (`in-` plus 12 hex characters), not derived from the team's name,
so knowing a team's name isn't enough to file tickets into its queue. Only the service role
reads it today. The admin page that shows it is SUP-91.

**The content is fetched, not trusted from the webhook.** Resend's event carries only
metadata: no body, no headers. SUP-89 fetches the email from Resend's API by its `email_id`, so
the content is whatever Resend actually received. Subjects and bodies are then untrusted text,
the same as any ticket: triage keeps its delimited prompt and strict JSON schema.

**Rate limits.** A bad signature costs only an HMAC: no database call. Signed deliveries are
capped at 300 per workspace per hour (`email_inbound:<workspace>` in `ticketing.rate_limits`);
past that they're held. Deliveries that match no workspace are acknowledged, but only the first 1000 an hour
across all workspaces are recorded, and ignored rows are deleted after 30 days, so spam to random
addresses at the shared receiving domain can't grow the table without bound. SUP-89 adds
per-sender limits and loop detection.

**The Vercel firewall.** The rule refuses more than 30 POSTs per IP per minute
(`docs/security/vercel-waf.md`), and Resend sends from a small set of addresses. A burst of
more than 30 emails a minute gets some 429s from the firewall. Resend retries those with
backoff, so the mail arrives late but isn't lost. If real volume ever needs more, add a
firewall exception for this path.

## Tables

- `ticketing.workspaces.inbound_address`: unique, `^in-[0-9a-f]{12}$`, filled by a volatile
  default. Not in the column grant for `authenticated`.
- `ticketing.inbound_email_events`: one row per delivery and workspace it reached, unique on
  (`svix_id`, `workspace_id`) and on (`resend_email_id`, `workspace_id`). `workspace_id` is null
  only when ignored. `status` is `received`, `held` or `ignored`, with a matching `reason`. RLS
  is on. Admins can read their own workspace's rows, and only `record_inbound_email_event()`
  writes them.

## Tests

`tests/email-webhook.spec.ts` signs requests with the configured secret and checks that:

- unsigned, wrongly signed, wrong-version, wrong-secret, tampered, stale and future-dated calls
  get 401;
- a correctly signed delivery is recorded once; its retry, and the same email under a new
  `svix-id`, are duplicates;
- a signature list (secret rotation) is accepted when one entry matches;
- signed but malformed bodies and over-long ids get 400, oversized bodies 413, and a workspace
  over its hourly cap gets its email held;
- unknown addresses and other domains are ignored;
- an email to workspace A's address is recorded for A, never for B, and one sent to both gets
  a separate row in each.
