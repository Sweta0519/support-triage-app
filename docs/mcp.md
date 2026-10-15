# MCP connector (epic SUP-47)

Support Triage is also a remote **MCP server** (Model Context Protocol). An AI assistant that
supports MCP, such as Claude or Cursor, can connect to it and work with tickets as the person
who connected it, with exactly the permissions that person has in the web app.

- **Endpoint:** `POST /api/mcp` (Streamable HTTP, stateless, JSON responses).
- **Sign-in:** `Authorization: Bearer <personal access token>`. People create tokens on the
  Account page (SUP-53).
- **Tools:** see [Tools](#tools). The tools on offer depend on the person's role, as it is now.

### Connecting an assistant

The homepage shows the same setups with a copy button (SUP-65), and the Account page shows them
once, right after a token is created, with that token filled in (SUP-66). Both use
`app/components/mcp/McpConnect.tsx`.
They're the clients that accept a URL and a bearer token. ChatGPT's and the Claude apps'
connectors sign in with OAuth, which this server doesn't support yet.

**Claude Code:**

```sh
claude mcp add --transport http support-triage https://support-triage-app-one.vercel.app/api/mcp \
  --header "Authorization: Bearer st_..."
```

**Cursor**, in `~/.cursor/mcp.json` (user-level, so the token isn't in a project):

```json
{ "mcpServers": { "support-triage": {
  "url": "https://support-triage-app-one.vercel.app/api/mcp",
  "headers": { "Authorization": "Bearer st_..." } } } }
```

**VS Code** (GitHub Copilot), in `.vscode/mcp.json`. VS Code asks for the token and keeps it in
its secret storage, so the file can be committed:

```json
{
  "inputs": [{ "type": "promptString", "id": "support-triage-token", "description": "Support Triage access token", "password": true }],
  "servers": { "support-triage": {
    "type": "http",
    "url": "https://support-triage-app-one.vercel.app/api/mcp",
    "headers": { "Authorization": "Bearer ${input:support-triage-token}" } } }
}
```

**OpenAI Codex**, in `~/.codex/config.toml`, with the token in `SUPPORT_TRIAGE_TOKEN`:

```toml
[mcp_servers.support-triage]
url = "https://support-triage-app-one.vercel.app/api/mcp"
bearer_token_env_var = "SUPPORT_TRIAGE_TOKEN"
```

Each tool's own docs: [Claude Code](https://code.claude.com/docs/en/mcp),
[Cursor](https://cursor.com/docs/mcp),
[VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration),
[Codex](https://developers.openai.com/codex/mcp).

## How a request is signed in (SUP-54)

1. **The token.** The route (`app/api/mcp/route.ts`) reads the bearer token. Anything that isn't
   `st_` plus 43 base64url characters is refused without a database call. Otherwise its SHA-256
   hash goes to `ticketing.resolve_access_token()` (service role only, in
   `app/lib/db/mcp-auth.ts`), which returns the owner if the token isn't revoked or expired, and
   records `last_used_at`. A bad, unknown, revoked or expired token is a `401` with
   `WWW-Authenticate: Bearer`.
2. **A real session for the owner.** The project's JWTs are signed with a key only Supabase
   holds, so the server can't mint a user JWT. Instead, the service role generates a one-time
   sign-in link for the owner (nothing is emailed), and its hash is exchanged for a session with
   `verifyOtp`, as clicking the link would.
   - **Refused (401):** owners who no longer exist, whose email isn't confirmed (verifying the
     link would confirm it), or who are banned. A refusal is remembered for a minute, so a client
     retrying the token doesn't repeat the Auth calls.
   - **Our side failing (503, `Retry-After`):** a database or Auth error. It's logged on the
     server, never detailed to the caller. If two server instances sign the same owner in at the
     same moment, one link replaces the other's, so the exchange is retried once with a fresh link.
   - **Cache:** sessions are kept in memory per owner (at most 500 owners per instance). A session
     is used for up to 5 minutes, then renewed with its refresh token. A new sign-in happens only
     when an instance first sees that owner, or a refresh fails.
   - Concurrent requests for one owner share one sign-in.
3. **Running as the owner.** The rest of the request runs inside `runWithUserSession()`
   (`app/lib/auth/clients.ts`). There, `createServerSupabaseClient()` sends that session's JWT
   instead of reading cookies, so every `app/lib/db/` function runs as the owner under the same
   RLS as the web app. The service role is never used for the tools' reads or writes.
4. **The role, every time.** The profile comes from `ensure_profile()` on every request, so the
   role is the one in `ticketing.profiles` right now, never a JWT claim. `session.ts`'s
   `getUser()` verifies the request's JWT (`currentUserSessionToken()`), so `getProfile()` and
   the `require*` helpers work here too. A demoted agent loses
   staff tools on their next call. The MCP server is built per request from that profile
   (`app/lib/mcp/server.ts`).
5. **Rate limit.** Each request counts against `mcp_request` (120 per 10 minutes), keyed on the
   owner, as soon as there's a session (alongside loading the profile). All of a person's tokens
   share one budget. Over it, the answer is `429` with `Retry-After`.

Revoking a token, deleting the account, or the token expiring all take effect on the next
request, because step 1 runs every time. The cached session only saves the sign-in; it never
replaces the token check. Changes Auth makes to the session itself (a ban, a password change, a
sign-out everywhere) take effect when the cached session is next renewed, within 5 minutes.

### Side effects of signing in this way

- Each new sign-in is a real Supabase sign-in for the owner. It shows as a login in Auth's logs
  and updates `last_sign_in_at`, and it adds a session that isn't signed out. That happens once
  per server instance per owner, and again only when a refresh fails.
- Supabase Auth appears to keep one pending sign-in-link token per user (not checked against
  its source). If so, generating one for the MCP sign-in replaces it, so a password-reset or
  magic-link email the owner hasn't clicked yet stops working, if a sign-in happens in between. This app doesn't send those emails today, but
  `auth.users` is shared with Notes Collections (`docs/supabase-schema.md`). The fix would be
  a JWT this server signs itself, with a signing key it holds that Supabase also accepts.

### Unknown tokens aren't throttled by the app

A request whose token is well-formed but unknown costs one indexed lookup by hash in the
database, and nothing else. It isn't counted against any app limit:

- the per-person limit needs a person;
- a per-IP limit would throttle hosted MCP clients, which call from shared addresses for
  everyone using them.

A 256-bit token can't be guessed, so this is about load, not access. The Vercel firewall rule
for `/api/mcp` (`docs/security/vercel-waf.md`) is the backstop.

## CSRF and browsers

This is the app's first mutating Route Handler. Server Actions get Next.js's POST-only
Origin/Host check against CSRF; this route doesn't need it:

- **It never reads cookies.** A request is signed in only by the `Authorization` header, which
  browsers never attach on their own. A page that tricks a signed-in visitor's browser into
  posting here gets a `401` (tested in `tests/mcp.spec.ts`).
- **No CORS headers are sent.** A web page can't send an `Authorization` header cross-origin
  (the preflight fails), and can't read the response.

The proxy doesn't run for exactly `/api/mcp` (its matcher in `proxy.ts` excludes it). So no
session cookie is read or refreshed there, and the route does its own sign-in.

## Tools

Every person gets `whoami`: the name, email and role the tools act as.

**Customers (SUP-55, `app/lib/mcp/customer-tools.ts`)** get what the web app lets them do with
their own tickets, through the same `app/lib/db/` functions, validation and rate limits:

| Tool | Does |
|---|---|
| `create_ticket(subject, description)` | Files a ticket as the web form does. AI triage starts after the answer (`after()`, service role, as from the form). Returns the number and link. |
| `list_my_tickets(status?)` | Their tickets, newest first (50 at most, filtered in the database, with `more` when there are others): number, subject, status, created and updated times. `status` can be `open` (not resolved or closed) or one status. |
| `get_ticket(number)` | One of their tickets: status, description, and the public replies with who wrote each (the customer, or support, with the staff member's name where the web shows it). |
| `add_reply(number, message)` | A public reply on one of their tickets. Closed tickets refuse it, as on the web. |

- **Not found means not yours.** A ticket number that isn't the customer's (someone else's, or
  none) gets the same "You don't have a ticket #N" answer.
- **Never triage or internal notes.** The tools don't ask for them, and RLS wouldn't return them
  to a customer anyway.
- **Staff don't get these tools.** Filing a ticket is the customer's action on the web too.
  Staff tools come in SUP-56.

- **Statuses** come back as the values the filter accepts (`in_progress`, not "in progress"), so
  an assistant can pass what it read straight back.
- **Reply authors** are `{"role": "you" | "support" | "deleted account"}`, and a staff member's
  chosen display name, when there is one, is in `name`, wrapped as untrusted.

**Errors.** Refusals the person can act on (a validation message, a rate limit, a closed ticket,
a ticket that isn't theirs) come back as tool errors in words (`isError`). If a tool fails on our
side (a database error, say), `guarded()` in `app/lib/mcp/results.ts` logs it on the server, and
the tool error says only that something went wrong, never the underlying message. Problems with
the request itself (bad arguments, an unknown tool) are JSON-RPC errors from the SDK.

## Untrusted text

Ticket subjects, descriptions, replies and other people's display names are written by people,
and could contain text aimed at the assistant ("ignore your instructions and..."). Tool results
are JSON, so such text can't break out of its field, and every such field is wrapped as
`{"untrusted_text": "..."}`
(`app/lib/mcp/results.ts`). The server's instructions tell the assistant to read those as
information, never as instructions. The same rule applies to the triage prompt
(`docs/ai-triage.md`).

## Limits

- Stateless: no server-to-client stream (`GET`) and no sessions (`DELETE`). Both answer `405`.
- Request bodies are capped at 256 KB.
- Auth's own limit on sign-in verifications applies per server IP. The session cache keeps
  sign-ins to about one per owner per server instance.
