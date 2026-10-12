# Vercel firewall rule for sign-in and sign-up

The app throttles sign-in and sign-up itself (SUP-13,
`ticketing.consume_auth_rate_limit()`). A Vercel WAF rule in front of it
is the coarse, network-level backstop that CLAUDE.md asks for. It stops a
flood before it costs a function call and a database round trip.

The rule lives only in the Vercel dashboard, so it can't be checked from
the repo (security scan I-7). Set it up, or confirm it, as follows.

## Rule

Go to Vercel → project **support-triage-app** → **Firewall** → **Configure** →
**New rule**:

| Setting | Value |
|---|---|
| Name | Throttle sign-in and sign-up |
| If | Request path *equals* `/login` **or** Request path *equals* `/signup` |
| And | Method *equals* `POST` |
| Then | **Rate limit**: fixed window, 60 seconds, 30 requests, keyed by **IP** |
| Action on limit | Deny (429) |

The Server Actions on these pages POST to the page's own path, so
`POST /login` and `POST /signup` are exactly the sign-in and sign-up
attempts. Page loads are `GET` and aren't affected.

The limit is deliberately looser than the app's own limits:

- sign-in: 20 per 10 minutes per IP, and an email locked after 10 failures
  in 15 minutes;
- sign-up: 5 per hour per IP and 3 per hour per email.

So the WAF only catches floods, and the app gives real users the friendly
"Too many attempts" message.

## Status

- [ ] Rule created or confirmed in the dashboard. Record who and when:
