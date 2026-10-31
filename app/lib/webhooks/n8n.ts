import "server-only";

import { createHmac } from "node:crypto";
import { after } from "next/server";
import { sanitizeIncidentText } from "@/app/lib/incidents";
import { markWebhookEvent, recordWebhookEvent } from "@/app/lib/db/webhooks";
import type { TriageCategory, TriagePriority, TriageTeam } from "@/app/lib/triage-fields";

// Signed outbound webhook to n8n (SUP-94). Fires after triage flags a ticket
// as an escalation risk. Advisory only: it never changes ticket status and
// sends nothing to the customer. The payload is built field by field (no
// spreads) so a new triage field can't leak out by accident, and the free
// text is scrubbed of emails, links, phone numbers and reference codes.
// Person names are kept out of the summary by the summary prompt itself.

export type EscalationData = {
  ticket_id: string;
  workspace_id: string;
  link: string;
  priority: TriagePriority;
  priority_reason: string;
  team: TriageTeam;
  category: TriageCategory;
  is_escalation_risk: boolean;
  summary: string;
};

// Extended by SUP-96 with "incident.opened".
export type WebhookEvent = { id: string; type: "ticket.escalation_flagged"; created_at: string; data: EscalationData };

export type WebhookResult = "skipped" | "sent" | "failed";

type EscalationSource = {
  priority: TriagePriority;
  priority_reason: string;
  team: TriageTeam;
  category: TriageCategory;
  is_escalation_risk: boolean;
  summary: string;
};

export function signWebhook(secret: string, timestamp: string | number, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function buildEscalationPayload(
  eventId: string,
  ticketId: string,
  workspaceId: string,
  o: EscalationSource,
): WebhookEvent {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return {
    id: eventId,
    type: "ticket.escalation_flagged",
    created_at: new Date().toISOString(),
    data: {
      ticket_id: ticketId,
      workspace_id: workspaceId,
      link: `${site}/tickets/${ticketId}`,
      priority: o.priority,
      priority_reason: sanitizeIncidentText(o.priority_reason),
      team: o.team,
      category: o.category,
      is_escalation_risk: o.is_escalation_risk,
      summary: sanitizeIncidentText(o.summary),
    },
  };
}

export function assertWebhookUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("webhook URL must not contain credentials");
  const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("webhook URL must be https");
  }
  return url;
}

export async function sendWebhook(
  event: WebhookEvent,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<WebhookResult> {
  const rawUrl = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!rawUrl || !secret) return "skipped";
  try {
    const url = assertWebhookUrl(rawUrl);
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": timestamp,
        "X-Signature": signWebhook(secret, timestamp, body),
        "X-Event-Id": event.id,
      },
      body,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return "sent";
  } catch (err) {
    console.error(`[webhook] ${event.type} ${event.id} failed: ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}

// Called from triage once a ticket is flagged. Synchronous and never throws:
// the work runs after the response, and a failure only lands in the log and
// the webhook_events row.
export function notifyEscalationFlagged(ticketId: string, output: EscalationSource): void {
  // Unconfigured: record nothing, so the ticket's one event isn't used up as
  // "skipped" before the webhook is switched on.
  if (!process.env.N8N_WEBHOOK_URL || !process.env.N8N_WEBHOOK_SECRET) return;
  after(async () => {
    try {
      const ev = await recordWebhookEvent("ticket.escalation_flagged", ticketId);
      if (!ev) return;
      const result = await sendWebhook(buildEscalationPayload(ev.id, ticketId, ev.workspace_id, output));
      await markWebhookEvent(ev.id, result);
    } catch (err) {
      console.error(`[webhook] escalation for ticket ${ticketId} failed:`, err instanceof Error ? err.message : err);
    }
  });
}
