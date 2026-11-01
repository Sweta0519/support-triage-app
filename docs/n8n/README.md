# n8n workflow setup

`escalation-alert.json` posts escalation and incident alerts to Slack. It checks the app's HMAC
signature with an n8n Crypto credential, so the same file works on local n8n and n8n Cloud.

## Setup

1. Generate a secret: `openssl rand -hex 32`. Use a separate secret for each n8n instance.
2. In n8n, create a Crypto credential and set Hmac Secret to that value. Set the app's
   `N8N_WEBHOOK_SECRET` to the same value.
3. Create a Slack API credential with the bot token for the right Slack workspace.
4. Import `escalation-alert.json`. Link the Crypto credential on Compute HMAC and the Slack
   credential on both Slack nodes. Re-link after every import: the export has no credentials.
5. Publish the workflow, then test it before setting the app's `N8N_WEBHOOK_URL`.

Why test first: a failed incident alert is never resent.

## Responses

| Status | Meaning |
| --- | --- |
| 401 | Wrong secret or stale timestamp |
| 422 | Signature fine, unsupported event type |
| 500 | Crypto credential missing or empty (or a Slack error) |

Never set On Error to Continue on Compute HMAC. The `c0` condition would then be the only guard
against forged signatures.
