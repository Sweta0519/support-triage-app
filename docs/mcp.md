# MCP connector (epic SUP-47)

Support Triage is also a remote **MCP server** (Model Context Protocol). An AI assistant that
supports MCP, such as Claude or Cursor, can connect to it and work with tickets as the person
who connected it, with exactly the permissions that person has in the web app.

- **Endpoint:** `POST /api/mcp` (Streamable HTTP, stateless, JSON responses).
- **Sign-in:** `Authorization: Bearer <personal access token>`. People create tokens on the
  Account page (SUP-53).
- **Tools so far:** `whoami`, which returns the name, email and role the tools act as. Customer
  tools (SUP-55) and staff tools (SUP-56) come next.

Connecting Claude Code, for example:

```sh
claude mcp add --transport http support-triage https://support-triage-app-one.vercel.app/api/mcp \
  --header "Authorization: Bearer st_..."
```

## How a request is signed in (SUP-54)

1. **The token.** The route (`app/api/mcp/route.ts`) reads the bearer token. Anything that isn't
   `st_` plus 43 base64url characters is refused without a database call. Otherwise its SHA-256
   hash goes to `ticketing.resolve_access_token()` (service role only, in
   `app/lib/db/mcp-auth.ts`), which returns the owner if the token isn't revoked or expired, and
   records `last_used_at`. Every failure is a `401` with `WWW-Authenticate: Bearer`.
2. **A real session for the owner.** The project's JWTs are signed with a key only Supabase
   holds, so the server can't mint a user JWT. Instead, the service role generates a one-time
   sign-in link for the owner (nothing is emailed), and its hash is exchanged for a session with
   `verifyOtp`, as clicking the link would. Owners whose email isn't confirmed are refused,
   because verifying the link would confirm it.
   - Sessions are cached in memory per owner and renewed with their refresh token. A new one is
     created only when a server instance first sees that owner, or a refresh fails.
   - Concurrent requests for one owner share one sign-in.
3. **Running as the owner.** The rest of the request runs inside `runWithUserSession()`
   (`app/lib/auth/clients.ts`). There, `createServerSupabaseClient()` sends that session's JWT
   instead of reading cookies, so every `app/lib/db/` function runs as the owner under the same
   RLS as the web app. The service role is never used for the tools' reads or writes.
4. **The role, every time.** The profile comes from `ensure_profile()` on every request, so the
   role is the one in `ticketing.profiles` right now, never a JWT claim. A demoted agent loses
   staff tools on their next call. The MCP server is built per request from that profile
   (`app/lib/mcp/server.ts`).
5. **Rate limit.** Each request counts against `mcp_request` (120 per 10 minutes), keyed on the
   owner, so all of a person's tokens share one budget. Over it, the answer is `429` with
   `Retry-After`.

Revoking a token, deleting the account, or the token expiring all take effect on the next
request, because step 1 runs every time. The cached session only saves the sign-in; it never
replaces the token check.

## CSRF and browsers

This is the app's first mutating Route Handler. Server Actions get Next.js's POST-only
Origin/Host check against CSRF; this route doesn't need it:

- **It never reads cookies.** A request is signed in only by the `Authorization` header, which
  browsers never attach on their own. A page that tricks a signed-in visitor's browser into
  posting here gets a `401` (tested in `tests/mcp.spec.ts`).
- **No CORS headers are sent.** A web page can't send an `Authorization` header cross-origin
  (the preflight fails), and can't read the response.

The proxy (`app/lib/auth/proxy.ts`) lists `/api/mcp` as public so it isn't redirected to
`/login`; the route does its own sign-in.

## Untrusted text

Ticket text is written by customers. When SUP-55 and SUP-56 return it, tool results mark it as
untrusted so the assistant on the other end treats it as data, not instructions. The same rule
applies to the triage prompt (`docs/ai-triage.md`).

## Limits

- Stateless: no server-to-client stream (`GET`) and no sessions (`DELETE`). Both answer `405`.
- Request bodies are capped at 256 KB.
- Auth's own limit on sign-in verifications applies per server IP. The session cache keeps
  sign-ins to about one per owner per server instance.
