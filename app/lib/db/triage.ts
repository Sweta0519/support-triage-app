import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { createServiceSupabaseClient } from "@/app/lib/supabase/service";
import type { TicketStatus } from "@/app/lib/db/tickets";

export type TriageResult = {
  id: string;
  ticket_id: string;
  model: string;
  prompt_version: string;
  summary: string;
  category: string | null;
  priority: string | null;
  priority_reason: string | null;
  team: string | null;
  frustration: number | null;
  is_escalation_risk: boolean;
  duplicate_of: string | null;
  related_ticket_ids: string[];
  suggested_reply: string | null;
  missing_info: string[];
  confidence: number | null;
  needs_human_review: boolean;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number | null;
  cost_usd: number | null;
  created_at: string;
};

const TRIAGE_RESULT_COLUMNS =
  "id, ticket_id, model, prompt_version, summary, category, priority, priority_reason, team, frustration, is_escalation_risk, duplicate_of, related_ticket_ids, suggested_reply, missing_info, confidence, needs_human_review, prompt_tokens, completion_tokens, latency_ms, cost_usd, created_at";

// ---- Reads on behalf of the signed-in user (RLS: staff-only) ------------

export async function getLatestTriageResult(ticketId: string): Promise<TriageResult | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("triage_results")
    .select(TRIAGE_RESULT_COLUMNS)
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// ---- Service-role writes, called only from app/lib/ai/triage.ts ---------
//
// Every function below bypasses RLS. None of them accept a caller-chosen
// ticket id from a browser without the Server Action having already
// established that the caller may act on that ticket.

export type TriageTicket = {
  id: string;
  subject: string;
  body: string;
  status: TicketStatus;
};

// Atomic claim: only one worker can flip pending -> processing. Zero rows
// back means another invocation already owns this ticket (or it isn't
// pending), so the caller must stop -- this is what prevents double
// triage when e.g. a retry and the original both fire.
export async function claimTicketForTriage(ticketId: string): Promise<TriageTicket | null> {
  const supabase = createServiceSupabaseClient();
  const { data: claimed, error: claimError } = await supabase
    .from("ticket_triage_state")
    .update({ triage_status: "processing" })
    .eq("ticket_id", ticketId)
    .eq("triage_status", "pending")
    .select("ticket_id")
    .maybeSingle();

  if (claimError) {
    throw new Error(claimError.message);
  }
  if (!claimed) {
    return null;
  }

  const { data: ticket, error } = await supabase
    .from("tickets")
    .select("id, subject, body, status")
    .eq("id", ticketId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return ticket;
}

// Used by the manual "re-run triage" path: put a completed/failed ticket
// back to pending so claimTicketForTriage() can pick it up again. A ticket
// that is `processing` is only reset if it has been stuck there for more
// than five minutes (updated_at is bumped by the claim) -- otherwise a
// re-run could interrupt a live run and both would write results.
const STALE_PROCESSING_MS = 5 * 60_000;

export async function resetTriageStatus(ticketId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const { error } = await supabase
    .from("ticket_triage_state")
    .update({ triage_status: "pending" })
    .eq("ticket_id", ticketId)
    .or(
      `triage_status.in.(completed,failed),and(triage_status.eq.processing,updated_at.lt.${staleBefore})`
    );

  if (error) {
    throw new Error(error.message);
  }
}

export async function upsertTicketEmbedding(
  ticketId: string,
  embedding: number[],
  embeddingModel: string
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("ticket_embeddings").upsert({
    ticket_id: ticketId,
    embedding,
    embedding_model: embeddingModel,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }
}

export type MatchedTicket = {
  ticket_id: string;
  subject: string;
  status: TicketStatus;
  latest_summary: string | null;
  similarity: number;
};

export async function matchTickets(
  embedding: number[],
  matchCount: number,
  excludeTicketId: string
): Promise<MatchedTicket[]> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.rpc("match_tickets", {
    query_embedding: embedding,
    match_count: matchCount,
    exclude_ticket_id: excludeTicketId,
  });

  if (error) {
    throw new Error(error.message);
  }
  return (data ?? []) as MatchedTicket[];
}

export type NewTriageResult = Omit<TriageResult, "id" | "created_at"> & {
  raw: unknown;
};

export async function insertTriageResult(row: NewTriageResult): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("triage_results").insert(row);

  if (error) {
    throw new Error(error.message);
  }
}

// Seeds the ticket's *working* fields (staff-only ticket_triage_state) from
// the AI's suggestion. Deliberately never touches tickets.status -- triage is
// advisory, and the guard trigger's transition map would reject it anyway.
export async function applyTriageToTicket(
  ticketId: string,
  fields: { priority: string | null; category: string | null; team: string | null }
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("ticket_triage_state")
    .update({ ...fields, triage_status: "completed" })
    .eq("ticket_id", ticketId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function markTriageFailed(ticketId: string): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase
    .from("ticket_triage_state")
    .update({ triage_status: "failed" })
    .eq("ticket_id", ticketId);

  if (error) {
    throw new Error(error.message);
  }
}

// actor_id is null on purpose: these events come from the system, not a
// person. Staff see them in the audit trail alongside human actions.
export async function insertTriageEvent(
  ticketId: string,
  eventType: "triage_completed" | "triage_failed",
  toValue: string | null
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { error } = await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: null,
    event_type: eventType,
    from_value: null,
    to_value: toValue,
  });

  if (error) {
    throw new Error(error.message);
  }
}
