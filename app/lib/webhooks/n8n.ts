import "server-only";

import { createHmac } from "node:crypto";
import { after } from "next/server";
import { createServiceSupabaseClient } from "@/app/lib/supabase/service";
import { sanitizeIncidentText } from "@/app/lib/incidents";
import { markWebhookEvent, readIncidentForAlert, recordIncidentOpenedEvent, recordWebhookEvent } from "@/app/lib/db/webhooks";
import type { TriageCategory, TriagePriority, TriageTeam } from "@/app/lib/triage-fields";

// Signed outbound webhook to n8n (SUP-94). Fires after triage flags a ticket
// as an escalation risk. Advisory only: it never changes ticket status and
// sends nothing to the customer. The payload is built field by field (no
// spreads) so a new triage field can't leak out by accident, and the free
// text is scrubbed of emails, links, phone numbers and reference codes.
// Person names are kept out of the summary by the summary prompt (best
// effort, not a guarantee). priority_reason is left out on purpose: it comes
// from the assessment call, which also sees other customers' candidate
// tickets. The event type already says it is an escalation.

export type EscalationData = {
  ticket_id: string;
  workspace_id: string;
  link: string;
  priority: TriagePriority;
  team: TriageTeam;
  category: TriageCategory;
  summary: string;
};

// SUP-96: the incident alert. Same rules as the escalation: field by field,
// scrubbed text, and never the customer update (draft_update).
export type IncidentOpenedData = {
  incident_id: string;
  workspace_id: string;
  link: string;
  title: string;
  ticket_count: number;
  summary: string | null;
};

export type EscalationEvent = { id: string; type: "ticket.escalation_flagged"; created_at: string; data: EscalationData };
export type IncidentOpenedEvent = { id: string; type: "incident.opened"; created_at: string; data: IncidentOpenedData };
export type WebhookEvent = EscalationEvent | IncidentOpenedEvent;

export type WebhookResult = "skipped" | "sent" | "failed";
export type WebhookOutcome = { result: WebhookResult; error?: string };

type EscalationSource = {
  priority: TriagePriority;
  team: TriageTeam;
  category: TriageCategory;
  summary: string;
};

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
}

// The one workspace allowed to send, or null when the webhook is off or
// misconfigured. skipLabel names the thing being skipped in the log line.
function allowedWorkspaceId(skipLabel: string): string | null {
  if (!process.env.N8N_WEBHOOK_URL || !process.env.N8N_WEBHOOK_SECRET) return null;
  const workspaceId = process.env.N8N_WEBHOOK_WORKSPACE_ID;
  if (!workspaceId) return null;
  if (!process.env.NEXT_PUBLIC_SITE_URL) {
    console.error(`[webhook] ${skipLabel} skipped: NEXT_PUBLIC_SITE_URL unset`);
    return null;
  }
  return workspaceId;
}

export function signWebhook(secret: string, timestamp: string | number, rawBody: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function buildEscalationPayload(
  eventId: string,
  ticketId: string,
  workspaceId: string,
  o: EscalationSource,
): EscalationEvent {
  const site = siteUrl();
  return {
    id: eventId,
    type: "ticket.escalation_flagged",
    created_at: new Date().toISOString(),
    data: {
      ticket_id: ticketId,
      workspace_id: workspaceId,
      link: `${site}/tickets/${ticketId}`,
      priority: o.priority,
      team: o.team,
      category: o.category,
      summary: sanitizeIncidentText(o.summary),
    },
  };
}

type IncidentSource = { id: string; title: string; summary: string | null; ticket_count: number };

export function buildIncidentOpenedPayload(
  eventId: string,
  workspaceId: string,
  source: IncidentSource,
): IncidentOpenedEvent {
  const site = siteUrl();
  return {
    id: eventId,
    type: "incident.opened",
    created_at: new Date().toISOString(),
    data: {
      incident_id: source.id,
      workspace_id: workspaceId,
      link: `${site}/incidents/${source.id}`,
      title: sanitizeIncidentText(source.title, 200) || "Possible incident",
      ticket_count: source.ticket_count,
      summary: source.summary ? sanitizeIncidentText(source.summary) || null : null,
    },
  };
}

export function assertWebhookUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.username || url.password) throw new Error("webhook URL must not contain credentials");
  const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("webhook URL must be https");
  }
  return url;
}

export async function sendWebhook(
  event: WebhookEvent,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<WebhookOutcome> {
  const rawUrl = process.env.N8N_WEBHOOK_URL;
  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (!rawUrl || !secret) return { result: "skipped" };
  try {
    const url = assertWebhookUrl(rawUrl);
    const body = JSON.stringify(event);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const res = await fetchImpl(url, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": timestamp,
        "X-Signature": signWebhook(secret, timestamp, body),
        "X-Event-Id": event.id,
      },
      body,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return { result: "sent" };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[webhook] ${event.type} ${event.id} failed: ${reason}`);
    return { result: "failed", error: reason };
  }
}

// Called from triage once a ticket is flagged. Synchronous. Must run inside a request (after() throws outside one; every triage path does):
// the work runs after the response, and a failure only lands in the log and
// the webhook_events row. Only the one configured workspace ever sends.
export function notifyEscalationFlagged(ticketId: string, output: EscalationSource): void {
  // Unconfigured: record nothing, so the ticket's one event isn't used up as
  // "skipped" before the webhook is switched on.
  const workspaceId = allowedWorkspaceId(`escalation for ticket ${ticketId}`);
  if (!workspaceId) return;
  after(async () => {
    try {
      const db = createServiceSupabaseClient();
      const ev = await recordWebhookEvent(db, ticketId, workspaceId);
      if (!ev) return;
      const { result, error } = await sendWebhook(buildEscalationPayload(ev.id, ticketId, ev.workspace_id, output));
      await markWebhookEvent(db, ev.id, result, error);
    } catch (err) {
      console.error(`[webhook] escalation for ticket ${ticketId} failed:`, err instanceof Error ? err.message : err);
    }
  });
}

// Sends the incident alert once. Exported without after() so it can be tested.
// Reads the incident fresh (workspace-filtered), skips one that was dismissed
// or resolved meanwhile, and lets the unique row decide who sends. A failed
// send is never retried.
export async function deliverIncidentOpened(
  db: ReturnType<typeof createServiceSupabaseClient>,
  incidentId: string,
  workspaceId: string,
  { fetchImpl }: { fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const incident = await readIncidentForAlert(db, incidentId, workspaceId);
  if (!incident || incident.status !== "open") return;
  const ev = await recordIncidentOpenedEvent(db, incidentId);
  if (!ev) return;
  const { result, error } = await sendWebhook(buildIncidentOpenedPayload(ev.id, ev.workspace_id, incident), { fetchImpl });
  await markWebhookEvent(db, ev.id, result, error);
}

// Called once from incident detection when a new incident opens. Same rules
// as notifyEscalationFlagged: synchronous, request scope only, one workspace only.
export function notifyIncidentOpened(incidentId: string): void {
  const workspaceId = allowedWorkspaceId(`alert for incident ${incidentId}`);
  if (!workspaceId) return;
  after(async () => {
    try {
      await deliverIncidentOpened(createServiceSupabaseClient(), incidentId, workspaceId);
    } catch (err) {
      console.error(`[webhook] alert for incident ${incidentId} failed:`, err instanceof Error ? err.message : err);
    }
  });
}
