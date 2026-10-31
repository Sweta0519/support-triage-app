import "server-only";

import type { createServiceSupabaseClient } from "@/app/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceSupabaseClient>;

// Outbound webhook log (SUP-94). Service role, because it runs in the
// background after triage with no signed-in user. It only inserts or claims a
// row and then updates that same row by id; the workspace is filled by a
// trigger from the ticket, never passed in. The caller passes the one
// workspace allowed to send, and nothing is recorded for any other.

export type WebhookEventType = "ticket.escalation_flagged";

// A pending row older than this is a send that died; it may be claimed again.
const STALE_PENDING_MS = 5 * 60 * 1000;

// Returns the row to send, or null. That is a newly inserted row, or an
// existing one that failed or has sat pending for over 5 minutes, claimed
// atomically by a conditional UPDATE (no read-then-write). Null otherwise, so
// a re-run of triage never sends the same escalation twice.
export async function recordWebhookEvent(
  db: ServiceClient,
  eventType: WebhookEventType,
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
    .upsert({ event_type: eventType, ticket_id: ticketId }, { onConflict: "event_type,ticket_id", ignoreDuplicates: true })
    .select("id, workspace_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (inserted) return inserted;

  const staleBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const { data: claimed, error: claimError } = await db
    .from("webhook_events")
    .update({ status: "pending", created_at: new Date().toISOString(), error: null })
    .eq("event_type", eventType)
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
