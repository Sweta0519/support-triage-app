# n8n workflow setup

`escalation-alert.json` posts escalation and incident alerts to Slack. It checks the app's HMAC
signature with an n8n Crypto credential, so the same file works on local n8n and n8n Cloud.

## Setup

1. Generate a secret: `openssl rand -hex 32`. Use a separate secret for each n8n instance.
2. In n8n, create a Crypto credential and set Hmac Secret to that value.
3. Create a Slack API credential with the bot token for the right Slack workspace. The bot needs
   the `chat:write` scope and must be invited to the channel. The workflow posts to the
   hardcoded `#support-alerts`.
4. Import `escalation-alert.json`. Link the Crypto credential on Compute HMAC and the Slack
   credential on both Slack nodes. Re-link after every import: the export has no credentials.
5. On any public instance, replace the Webhook path `escalation` with the output of
   `openssl rand -hex 16`. Every POST to a known path costs an execution, even when it ends in
   401. An unknown path gets a 404 and costs none. This is a cost control; the signature is the
   real check. Never commit the real path: restore `escalation` when you re-export. Re-importing
   resets the path, so edit the published workflow in place.
6. In Workflow settings, confirm that successful production executions aren't saved and failed
   ones are. The export sets this, but that an import keeps it isn't verified.
7. Publish the workflow, then test it (below) before setting the app's `N8N_WEBHOOK_URL`.
8. Set these app env vars to enable it: `N8N_WEBHOOK_URL`, `N8N_WEBHOOK_SECRET` (the same value as
   step 2), `N8N_WEBHOOK_WORKSPACE_ID` and `NEXT_PUBLIC_SITE_URL`. Without all four, nothing is
   sent or recorded. In production `N8N_WEBHOOK_URL` must be https. A Vercel env change applies
   on the next deploy.

Why test first: a failed incident alert is never resent.

## Re-importing

The export has no id, so importing onto an instance that already has the workflow creates a
second workflow with the same path. Unpublish the old one first, or publishing hits a webhook
conflict.

## Test it

Send a signed request with an event type the workflow doesn't handle. Expect 422, and nothing is
posted to Slack. Set `N8N_URL` to the production webhook URL (not the test URL) and
`N8N_SECRET` to the secret from step 1:

```bash
ts=$(date +%s)
body='{"id":"test-1","type":"tmp.unknown","created_at":"2026-01-01T00:00:00.000Z","data":{}}'
sig="sha256=$(printf '%s' "${ts}.${body}" | openssl dgst -sha256 -hmac "$N8N_SECRET" -hex | awk '{print $NF}')"
curl -i -X POST "$N8N_URL" \
  -H 'Content-Type: application/json' \
  -H "X-Timestamp: ${ts}" \
  -H "X-Signature: ${sig}" \
  --data-raw "$body"
```

The signature is `sha256=<hex>` over `${ts}.${body}`, the same as `signWebhook` in
`app/lib/webhooks/n8n.ts`. The workflow recomputes it over `JSON.stringify($json.body)`, so the
body must be compact JSON (no spaces) and byte-for-byte what you signed. A plain `curl` with no
signature gets 401.

## Responses

| Status | Meaning |
| --- | --- |
| 401 | Wrong secret, missing signature or stale timestamp |
| 404 | Workflow not published, wrong path, or the test URL used instead of the production URL |
| 422 | Signature fine, unsupported event type |
| 500 | Crypto credential missing or empty, or a Slack error such as `channel_not_found` |

The app records any non-2xx response as `failed`. A timeout can be recorded as `failed` even
though Slack posted. Failed incident alerts are never resent.

Never set On Error to Continue on Compute HMAC. The `c0` condition would then only stop the
empty-digest forgery. An empty secret is refused only because the Crypto node throws (checked on
n8n 2.45.7). `c0` can't detect it, since an empty-key digest isn't empty. Re-check this with an emptied
credential after any n8n upgrade.

A captured request can be replayed for 5 minutes and repeats the same alert. There is no dedupe.

## Data

n8n receives the AI-written summary of a flagged ticket, or an incident's title and summary, with
ids, a link, and the request headers including the signature. Only failed runs are saved. A
stored signature is useful to an attacker for only 5 minutes and doesn't reveal the key.
