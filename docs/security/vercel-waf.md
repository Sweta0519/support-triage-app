# Vercel firewall rule

The app throttles abuse itself:
- sign-in and sign-up (SUP-13, `ticketing.consume_auth_rate_limit()`);
- per-user limits on sensitive actions (`ticketing.consume_rate_limit()`);
- MCP calls, 120 per person per 10 minutes (SUP-54).

A Vercel firewall rule in front of it is the coarse, network-level backstop that CLAUDE.md asks for.
It stops a flood before it costs a function call and a database round trip.

The rule lives only in Vercel, not in the repo (security scan I-7). Check it with the Vercel CLI,
logged in to the project's team:

```sh
vercel firewall rules list
vercel firewall rules inspect "Rate limit POSTs by IP"
```

(`vercel firewall overview` fails on the Hobby plan, which has no IP bypass; `rules list` works.)

## The live rule

| Setting | Value |
|---|---|
| Name | Rate limit POSTs by IP |
| If | Method *equals* `POST` (every path) |
| Then | **Rate limit**: fixed window, 60 seconds, 30 requests, keyed by **IP** |
| Action on limit | Rate limit (429) |
| Description | Coarse backstop: 30 POST requests/min per IP. App-level per-user limits live in ticketing.consume_rate_limit(). |

Everything that changes data, and every login attempt, is a POST, and every one counts:
- sign-in and sign-up, because their Server Actions POST to `/login` and `/signup`;
- every other Server Action: replies, status changes, card moves, Sage messages, and the admins'
  once-a-minute count check;
- every call to `/api/mcp`.

Page loads are `GET` and never count.

The limit is looser than the app's own sign-in and sign-up limits:
- sign-in: 20 wrong passwords per 10 minutes per IP, 10 per email and IP, and 50 per email in
  15 minutes;
- sign-up: 5 per hour per IP and 3 per hour per email.

So a real user who mistypes still gets the app's friendly "Too many attempts", and the firewall
only catches floods.

### Trade-off: one rule for every POST

The rule covers more than sign-in. That was accepted on 2026-10-16 (SUP-74), rather than a
dashboard change. It also catches floods of `/api/mcp` requests with unknown tokens, which the
app doesn't count (`docs/mcp.md`).

The cost is that a burst of more than 30 POSTs in a minute from one IP is refused with a 429:
- a very busy person;
- an AI assistant making many MCP calls at once;
- several people behind one office address.

The MCP clients this app supports (Claude Code, Cursor, VS Code, Codex) call from the user's own
machine, so the limit is per person in practice. A hosted client calling from shared addresses
would hit it sooner. Its per-person MCP allowance (120 per 10 minutes) is larger in total, but
not per minute.

### If it needs refining

These two path rules would limit only sign-in and sign-up and leave the rest of the app alone.
The Hobby plan probably allows only one rate-limit rule, which would explain why there's one
combined rule now.

| Name | If | Then |
|---|---|---|
| Throttle sign-in and sign-up | Path *equals* `/login` or `/signup`, and method *equals* `POST` | Rate limit: 60 s, 30 requests, by IP, deny (429) |
| Throttle MCP endpoint | Path *equals* `/api/mcp` | Rate limit: 60 s, 300 requests, by IP, deny (429) |

## Status

- [x] Rule confirmed live on 2026-10-16. Checked with `vercel firewall rules list` and
      `inspect`, as the project owner's account (sweta0519). It is the one rule above, enabled.
