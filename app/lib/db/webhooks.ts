import "server-only";

import type { createServiceSupabaseClient } from "@/app/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

// Outbound webhook log (SUP-94, SUP-96). Service role, because it runs in the
// background after triage with no signed-in user. It only inserts or claims a
// row and then updates that same row by id; the workspace is filled by a
// trigger from the ticket (or the incident), never passed in. The caller checks the one workspace allowed to send before recording:
// recordWebhookEvent takes it as a parameter, and deliverIncidentOpened reads
// the incident filtered by it first.

// A pending row older than this is a send that died; it may be claimed again.
const STALE_PENDING_MS = 5 * 60 * 1000;

// Returns the row to send, or null. That is a newly inserted row, or an
// existing one that failed or has sat pending for over 5 minutes, claimed
// atomically by a conditional UPDATE (no read-then-write). Null otherwise, so
// a re-run of triage never sends the same escalation twice.
export async function recordWebhookEvent(
  db: ServiceClient,
  ticketId: string,
  allowedWorkspaceId: string,
): Promise<{ id: string; workspace_id: string } | null> {
  // Only the allowed workspace's tickets are recorded at all.
  const { data: ticket, error: ticketError } = await db
    .from("tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("workspace_id", allowedWorkspaceId)
    .maybeSingle();
  if (ticketError) throw new Error(ticketError.message);
  if (!ticket) return null;

  const { data: inserted, error } = await db
    .from("webhook_events")
    .upsert({ event_type: "ticket.escalation_flagged", ticket_id: ticketId }, { onConflict: "event_type,ticket_id", ignoreDuplicates: true })
    .select("id, workspace_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (inserted) return inserted;

  const staleBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const { data: claimed, error: claimError } = await db
    .from("webhook_events")
    .update({ status: "pending", created_at: new Date().toISOString(), error: null })
    .eq("event_type", "ticket.escalation_flagged")
    .eq("ticket_id", ticketId)
    .eq("workspace_id", allowedWorkspaceId)
    .or(`status.eq.failed,and(status.eq.pending,created_at.lt.${staleBefore})`)
    .select("id, workspace_id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  return claimed ?? null;
}

export async function markWebhookEvent(
  db: ServiceClient,
  id: string,
  result: "sent" | "failed" | "skipped",
  error?: string,
): Promise<void> {
  const { error: dbError } = await db
    .from("webhook_events")
    .update({
      status: result,
      error: result === "failed" ? (error ?? "unknown error").slice(0, 500) : null,
      sent_at: result === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (dbError) throw new Error(dbError.message);
}

// What the incident alert needs, read fresh at send time and filtered by
// workspace. draft_update (the customer update) is never selected.
export async function readIncidentForAlert(
  db: ServiceClient,
  incidentId: string,
  workspaceId: string,
): Promise<{ id: string; title: string; summary: string | null; status: string; ticket_count: number } | null> {
  const { data, error } = await db
    .from("incidents")
    .select("id, title, summary, status, tickets:incident_tickets(count)")
    .eq("id", incidentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { tickets, ...rest } = data as unknown as {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    tickets: { count: number }[];
  };
  return { ...rest, ticket_count: tickets[0]?.count ?? 0 };
}

// One incident.opened row per incident: the unique (incident_id, event_type)
// is the send-once guard. Returns the new row, or null when one exists. No
// re-claim: a failed or stuck incident alert is never resent.
export async function recordIncidentOpenedEvent(
  db: ServiceClient,
  incidentId: string,
): Promise<{ id: string; workspace_id: string } | null> {
  const { data, error } = await db
    .from("webhook_events")
    .upsert({ event_type: "incident.opened", incident_id: incidentId }, { onConflict: "incident_id,event_type", ignoreDuplicates: true })
    .select("id, workspace_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}
