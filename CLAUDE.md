@AGENTS.md

# Support Ticket / Inbox Triage App

## What this is

A support ticketing app with three roles -- customer, agent, admin -- built around an AI triage
agent: every incoming ticket is automatically analyzed for category, priority (with a stated
reason), team routing, duplicate/related tickets, an escalation-risk flag, a draft first reply,
and follow-up questions when the ticket is missing information. The AI feature is the reason
this app exists -- removing it would leave a plain unremarkable CRUD ticketing form. Triage is
strictly advisory: it never changes ticket status and never sends a reply on its own. Staff also
have Sage, a private assistant widget that remembers its conversation and can search the staff
member's own knowledge notes (RAG) -- separate from triage and never customer-facing.

Built as a mid-sprint/sprint-project-style practice project (Turing College conventions) --
security is a baseline expectation (RLS everywhere, CSRF, rate limiting, secure sessions), not
the centerpiece; the AI triage behavior is what should get the most scrutiny.

## Stack

- Next.js (App Router), TypeScript, Tailwind CSS
- Supabase as the storage layer, accessed via `supabase-js` directly (no Supabase MCP server)
- OpenRouter for the triage LLM call and embeddings, called server-side only
- Email/password authentication via Supabase Auth
- Runs locally via `npm run dev`; deploys to Vercel

## Database

- **This project shares its Supabase project with a separate app, `notes-collections`.** That
  app owns the `public` schema. Everything for this app lives in a dedicated **`ticketing`**
  schema in the same database -- see `docs/supabase-schema.md` for the full rationale and the
  consequences of sharing one `auth.users` pool between two apps.
- **Schema changes are migrations, not dashboard edits.** Every schema change is a file in
  `supabase/migrations/`, applied via the Supabase CLI. This is the opposite of
  `notes-collections`' convention (dashboard-managed tables) -- don't mix the two approaches
  within this repo.
- **All Supabase reads and writes go through `app/lib/db/`.** No component or route handler
  calls the Supabase client directly.
- Supabase project URL and anon key are read from environment variables
  (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`), set in `.env.local` (copied from
  `.env.example`). Never commit `.env.local`.
- The service-role key (`SUPABASE_SERVICE_ROLE_KEY`) bypasses RLS entirely. It lives only in
  `app/lib/supabase/service.ts` (marked `import "server-only"`), never in `app/lib/auth/clients.ts`
  or any file reachable from client components.

## AI model calls

- All LLM and embedding calls must happen server-side only. Never call OpenRouter from browser
  code.
- `OPENROUTER_API_KEY` lives in `.env.local` and must never have a `NEXT_PUBLIC_` prefix or be
  passed to client components.
- Model: `anthropic/claude-haiku-4.5` (pinned as `TRIAGE_MODEL` in `app/lib/ai/openrouter.ts`).
  Chosen because this OpenRouter workspace's guardrail blocks Sonnet-tier endpoints -- check
  `GET https://openrouter.ai/api/v1/models/user` with the key before changing the slug, and note
  OpenRouter slugs use **dotted** versions (`4.5`), not Anthropic's hyphenated ids.
- Embeddings: `openai/text-embedding-3-small` via OpenRouter, used for duplicate/related-ticket
  detection and for the staff notes search behind Sage (`ticketing.documents`).
- The `embedding` columns on `ticketing.ticket_embeddings` and `ticketing.documents` are
  `vector(1536)` -- do not change this dimension.
- Never change the embedding model after initial setup. Changing it breaks retrieval silently
  (existing vectors were produced by a different model and are no longer comparable). If it ever
  must change, drop and re-embed every row in both tables in the same migration.
- Sage (the floating staff assistant, `app/components/assistant/`) does agentic RAG over a staff
  member's own notes: `search_notes` is a tool the model decides to call, not a step that always
  runs (`app/lib/ai/notes-rag.ts`). The one exception: a message that plainly asks about the
  staff member's own notes (`isExplicitNotesQuestion`, `app/lib/ai/notes-question.ts`) forces a
  search on the first round, so Sage never answers those from an earlier reply or says "not in your
  notes" without looking. Retrieval is scoped to the caller *inside*
  `ticketing.match_documents()` (`auth.uid()`) and by RLS on `documents` -- never add a
  client-supplied user-id parameter to that function or to the tool.
- Notes are chunked (~500 chars, 100 overlap) and embedded *before* the row is saved, so a note
  is never stored without its index; an edit deletes and re-embeds all of its chunks.
- Triage output is strictly advisory: it must never auto-change `ticketing.tickets.status` and
  must never send a reply to the customer without an agent/admin action.
- Learning from corrections (`docs/learning.md`) feeds the assessment call past staff
  corrections of similar tickets. It passes only scrubbed AI summaries and field values, never
  another ticket's text or id, and never passes them to the reply call.
- Incident detection (`docs/incidents.md`) follows the same rules:
  - an incident never changes ticket status by itself;
  - its update is posted only when staff press the button;
  - the incident note's model call sees only the grouped tickets' AI summaries, never raw ticket
    text, and the draft customer update is sanitized of customer-specific details.
- The public homepage's "Safe by design" strip (`SAFETY` in `app/welcome/page.tsx`) states three of
  these rules to visitors: advisory triage (no status changes or replies by the AI), RLS on every
  table (with published status pages as the one exception), and untrusted ticket text with
  strict-format output. Changing any of them means updating that copy (and its test) too.
- Ticket bodies are untrusted input to the model (prompt injection risk). The triage prompt must
  keep instructions and untrusted ticket content clearly delimited, use `response_format:
  json_schema` with `strict: true`, and restrict any duplicate/related-ticket IDs the model can
  return to a candidate list computed server-side -- the model must never be able to invent an
  ID or reference a ticket that wasn't already in that candidate set.

## Authentication and roles

- Use Supabase Auth for all sign-in and session handling -- never build custom auth or store
  passwords.
- Every page under the `(app)` route group requires a signed-in user, verified server-side
  (`app/lib/auth/session.ts`); redirect to `/login` if not signed in.
- Role is `ticketing.profiles.role` (`customer` | `agent` | `admin`), never a JWT claim -- a
  demoted admin must lose access immediately, not only after token refresh.
- `requireRole(...)` / `requireStaff()` / `requireAdmin()` in `app/lib/auth/session.ts` gate
  role-specific routes server-side. `proxy.ts` (`middleware.ts`) only refreshes sessions and
  redirects unauthenticated visitors -- it must never contain role/authorization logic (Next.js
  proxy is not an authorization layer).
- The one other proxy rule: a signed-out visitor at `/` is rewritten to the public homepage
  (`app/welcome/`, SUP-48), so the address stays `/`. Signed-in users get the app at `/`.
- A user can exist in `auth.users` without a `ticketing.profiles` row yet (see Database above).
  Any code path that reads `profiles` for the current user must call
  `ticketing.ensure_profile()` first, not assume the row exists.
- After sign-in, redirect to `/`. After sign-out, redirect to `/login`.
- Build email-confirmation/redirect links from `NEXT_PUBLIC_SITE_URL`, never from the request's
  `Origin`/`Host` headers.

## Security baseline

- Every table in the `ticketing` schema has RLS enabled with at least one owner- or role-scoped
  policy -- no table is left with a permissive default.
- CSRF: all state-changing operations (ticket creation, status changes, comments, role changes)
  go through Next.js Server Actions, relying on their built-in POST-only + Origin/Host check.
  Do not add a plain mutating Route Handler without re-evaluating this -- Route Handlers don't
  get the same protection.
- Rate limiting: a Postgres-backed atomic counter (`ticketing.rate_limits`, RPC-only, deny-all
  RLS) on sensitive/public actions, plus a Vercel WAF rule as a coarse network-level backstop.
- Assignment must use a conditional `UPDATE ... WHERE assignee_id IS NULL` with a rowcount
  check -- never read-then-write -- to avoid two agents claiming the same ticket.

## Conventions

- New pages go inside `app/`. Shared UI components go in `app/components/`.
- One feature per branch, merged via pull request. Commit at each stable state. `main` is
  protected (`docs/branch-protection.md`): there are no direct pushes, and a PR merges only once
  the Vercel preview check passes and every review thread is resolved. Running the tests and the
  reviews is on you; GitHub doesn't check that they ran.
- UI redesigns are engineering changes, not cosmetic ones. They get the same branch, tests and
  two-tool review as any feature, and the PR fills in the UI section of
  `.github/pull_request_template.md`.
- An optional task is claimed as PR-delivered (in the README) only after its feature branch is
  merged. A task that went straight to `main` says so, with the commit.
- Commit messages are descriptive (what changed and why) -- never "updates" or "stuff".
- Before merging a PR, review its diff with both tools:
  - `/code-review --comment <PR>`: the third-party review command, a review skill bundled with
    Claude Code. It is not written or tuned in this repo, and it is not the
    `claude-plugins-official` `code-review` plugin.
  - the `ai-code-reviewer` subagent, defined in this repo at `.claude/agents/ai-code-reviewer.md`.
    In Claude Code, ask for it by name on `git diff main...HEAD`, and name the PR's risky areas.

  `docs/reviews/README.md` says which tool produced which review and where the evidence is.
- Review findings always go on the PR as inline review comments (one comment per finding, on
  the relevant file and line), not only in the terminal. When a finding is fixed, reply on its
  comment thread saying what changed and in which commit, then mark the thread resolved. A
  finding that is deliberately not fixed gets a reply explaining why.

## Do not

- Add npm packages without asking first.
- Put secrets or API keys in source files -- use `.env.local`.
- Store passwords or write custom password-handling logic anywhere -- Supabase Auth handles it.
- Grant a client-facing path (RLS policy or column grant) that lets any role update
  `ticketing.profiles.role` directly -- role changes go through `ticketing.admin_set_role()`
  only.
