# Security review of PR #1 diff (`feature/m7-readme-security-tests` vs `main`)

- Date: 2026-09-03
- Tool: `/security-review` methodology run by a fresh general-purpose subagent (identify ->
  false-positive filter -> report only confidence >= 7 with a concrete exploit path)
- Scope: the PR diff only -- `README.md`, `docs/screenshots/ticket-triage.png`,
  `tests/role-matrix.spec.ts`, `next.config.ts`, `app/lib/ai/triage.ts` (prompt change)
- Result: **no findings meet the reporting bar**

## Report (verbatim)

This PR is additive hardening plus documentation and tests. Nothing in it introduces a new input,
a new privilege boundary, a new data sink, or a new rendering path. Specifically:

- **`next.config.ts` -- new CSP and security headers (only real code-surface change).** Adding
  headers cannot weaken a page that previously had none. `script-src 'self' 'unsafe-inline'` is
  a hardening gap (no nonce, so CSP will not stop an injected inline script), but it is not itself
  a vulnerability: the app has no `dangerouslySetInnerHTML` or other unsafe HTML sinks anywhere
  under `app/`, so there is no XSS for the weak CSP to fail to mitigate. `'unsafe-eval'` is
  correctly gated on `NODE_ENV === "development"` (env vars are trusted). `frame-ancestors 'none'`
  / `X-Frame-Options: DENY`, `form-action 'self'`, `base-uri 'self'`, `object-src 'none'` are all
  strictly restrictive. `connect-src 'self'` is verified accurate: `createBrowserSupabaseClient`
  is exported but has zero callers, so no browser-side Supabase traffic exists to be blocked or
  to need an allow-listed origin. The `headers()` source `/(.*)` applies uniformly; no route is
  excluded.
- **`app/lib/ai/triage.ts` -- prompt text change and `PROMPT_VERSION` bump only.** The diff
  touches one rule sentence in `SYSTEM_PROMPT` (forbidding timeframes in `suggested_reply`) and
  the version constant. No change to input handling, schema construction, candidate-id
  restriction, `normalize()` post-validation, or DB writes. Model output continues to be rendered
  via React text nodes and is length-capped, so the AI output remains a data-only path.
- **`tests/role-matrix.spec.ts`** -- test-only file, excluded per the methodology. Credentials are
  read from env vars, not hardcoded.
- **`README.md`** -- documentation, excluded; checked anyway for leaked secrets and found only
  placeholder values. The live URL disclosed is already public in `next.config.ts`'s
  `allowedOrigins`.
- **`docs/screenshots/ticket-triage.png`** -- inspected the image: it shows a synthetic test
  ticket (fabricated order number, truncated ticket ids, a deliberate prompt-injection line). No
  real emails, user ids, keys, or PII.

One non-security observation: the screenshot's suggested reply says *"We'll follow up with you
within one business day"* -- exactly the behaviour commit `18db60b` fixes -- and the panel footer
reads prompt `2026-09-03.1`, the old version. Regenerating the screenshot after the prompt change
would make the README consistent with the code.

## Follow-up

- The unused `createBrowserSupabaseClient` export noted above was removed in the same PR (see
  `audit-1-initial.md`, S1), and the auth cookies were made `httpOnly`.
- Screenshot regenerated after a ticket was triaged with `PROMPT_VERSION` `2026-09-03.2`.
