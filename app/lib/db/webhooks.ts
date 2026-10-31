import "server-only";

import { createServiceSupabaseClient } from "@/app/lib/supabase/service";

// Outbound webhook log (SUP-94). Service role, because it runs in the
// background after triage with no signed-in user. It only inserts a row and
// then updates that same row by id; the workspace is filled by a trigger from
// the ticket, never passed in.

export type WebhookEventType = "ticket.escalation_flagged";

// Returns null when this event was already recorded for the ticket, so a
// re-run of triage never sends the same escalation twice.
export async function recordWebhookEvent(
  eventType: WebhookEventType,
  ticketId: string,
): Promise<{ id: string; workspace_id: string } | null> {
  const { data, error } = await createServiceSupabaseClient()
    .from("webhook_events")
    .upsert({ event_type: eventType, ticket_id: ticketId }, { onConflict: "event_type,ticket_id", ignoreDuplicates: true })
    .select("id, workspace_id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function markWebhookEvent(
  id: string,
  result: "sent" | "failed" | "skipped",
  error?: string,
): Promise<void> {
  const { error: dbError } = await createServiceSupabaseClient()
    .from("webhook_events")
    .update({
      status: result,
      error: error ?? null,
      sent_at: result === "sent" ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (dbError) throw new Error(dbError.message);
}
