# Support Ticket Triage

A support ticketing app -- customers file tickets, agents work a queue, admins run the team --
built around an **AI triage agent**. Every new ticket is assessed by an LLM the moment it's
filed, so an agent opening the queue already knows what each ticket is about, how urgent it is
and why, which team should own it, whether it's a repeat of something already open, and how they
might start replying.

**Live:** https://support-triage-app-one.vercel.app (requires sign-in; open it in an incognito
window and you land on the login page, never on data).

![Agent view of a ticket with the AI triage panel](docs/screenshots/ticket-triage.png)

## Why the AI feature is the core, not a bolt-on

Without triage this is a plain CRUD ticket form -- a queue of subjects sorted by date. The value
of the product is that a human never has to read a ticket cold:

- **Category, priority and a stated reason.** Not just "high" but *"paying customer reports a
  duplicate charge with the order number provided; clear financial impact"*.
- **Team routing** (support / billing / engineering).
- **Duplicate and related-ticket detection** via pgvector similarity search over previous tickets.
- **Frustration score and escalation-risk flag.**
- **A draft first reply** that acknowledges the specifics and asks for whatever is missing --
  shown to the agent, never sent automatically.
- **"Still needed from the customer"** so the agent's first message is the right question.

Remove it and the app has no reason to exist over a shared inbox.

The AI is deliberately **advisory**: it seeds a staff-only working-state record (priority,
category, team) and records its full assessment in an append-only audit table, but it never
changes ticket status and never sends anything to a customer. Nothing it produces is readable by
the customer who filed the ticket -- not in the UI and not through the database API.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth + RLS + pgvector) ·
OpenRouter (`anthropic/claude-haiku-4.5` for assessment, `openai/text-embedding-3-small` for
embeddings) · Vercel.

## Security model (baseline, not the centrepiece)

- Three roles (`customer` / `agent` / `admin`) enforced by **RLS on every table**, not UI checks.
  Customers see only their own tickets; agents see unassigned tickets and their own; admins see all.
- Role changes only through a `SECURITY DEFINER` RPC that refuses self-changes and demoting the
  last admin. Signup **hard-codes** `customer` and ignores client metadata.
- A `BEFORE UPDATE` trigger enforces what RLS can't: immutable ticket text, legal status
  transitions, staff-only assignees, race-free claiming.
- CSRF via Server Actions' built-in Origin/Host check; **no mutating Route Handlers exist**.
- Per-user **rate limiting** in Postgres + a Vercel WAF rule; security headers incl. a CSP.
- `OPENROUTER_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are read only in `server-only` modules.
  Ticket text is treated as untrusted model input (closed strict schema, delimited, candidate-
  restricted ids). See `docs/ai-triage.md` for the prompt-injection and privacy analysis.

Full schema, policies and functions: `docs/supabase-schema.md`.

## Run it locally

```bash
npm install
cp .env.example .env.local   # then fill in the values below
npm run dev                  # http://localhost:3000
```

| Variable | Where to get it | Exposed to browser? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard -> Project Settings -> API -> Project URL | Yes (by design) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page -> `anon` / publishable key | Yes (by design; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | Same page -> `service_role` (secret). Bypasses RLS. | **Never** |
| `OPENROUTER_API_KEY` | https://openrouter.ai -> Keys | **Never** |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally; the deployed URL in production | Yes |

Database setup (one-time, needs the Supabase CLI which is a dev dependency):

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push          # applies supabase/migrations/ in order
```

Then in the Supabase dashboard: **Settings -> API -> Data API -> Exposed schemas** -> add
`ticketing`. This app keeps every table in its own `ticketing` schema (it shares a Supabase
project with another app -- see `docs/supabase-schema.md` for why and what that implies).

Make yourself admin once you've signed up (SQL editor):

```sql
update ticketing.profiles set role = 'admin' where email = 'you@example.com';
```

Without `OPENROUTER_API_KEY` the app runs normally and tickets simply stay `pending` triage.

## Tests

```bash
npx playwright install chromium
npx playwright test
```

The suite runs against the real Supabase project and, for the AI test, the real OpenRouter API.
It needs dedicated test accounts in `.env.local` (`TEST_USER_*` customer A, `TEST_USER_B_*`
customer B, `TEST_AGENT_*`, `TEST_ADMIN_*`, `TEST_ROLEFLIP_EMAIL`) -- create them with the Supabase
Admin API (`auth.admin.createUser` with `email_confirm: true`) and set roles via the service role.
Coverage: customer flow; **cross-user isolation** (customer B gets a 404 for customer A's ticket);
agent claim / status / internal notes hidden from the customer; **AI triage happy path** with the
panel never rendered for customers; admin role gate, role changes, reassignment; agent 404 for
another staff member's ticket; customer bounced from staff routes.

## Optional tasks completed

- **Deploy to a live Vercel URL** (medium) -- secrets live only in the Vercel dashboard.
- **Playwright tests for the AI feature** (medium) -- real LLM call asserted end to end, plus the
  signed-out lockout and cross-user checks.
- **Model display** (easy) -- the triage panel shows the exact OpenRouter slug, prompt version
  and latency.
- **Two-user cross-account test** and **security headers** from the mid-sprint list.

## Docs

- `docs/ai-triage.md` -- pipeline, schema, prompt-injection and privacy analysis (cites OpenRouter
  and Supabase sources).
- `docs/supabase-schema.md` -- every table, policy, trigger and function.
- `docs/security/` -- security audit reports (initial scan, fixes, fresh-context rescan).
- `docs/reviews/` -- `ai-code-reviewer` report recorded before merging the PR.
- `CLAUDE.md` -- the AI rules and conventions the codebase is built to.
