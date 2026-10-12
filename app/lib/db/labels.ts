import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import type { LabelColor, TeamLabel } from "@/app/lib/labels";

// Team labels (SUP-39). RLS: staff only; applying a label needs a ticket the
// caller can see. Every add/remove is recorded in ticket_events by a trigger.

export class LabelNameTakenError extends Error {
  constructor() {
    super("label name taken");
  }
}

export async function listLabels(): Promise<TeamLabel[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("labels").select("id, name, color").order("name");
  if (error) throw new Error(error.message);
  return data as TeamLabel[];
}

// Ticket ids go in the request URL, so they're sent in chunks: a few hundred
// open tickets in one `in.(...)` would pass the URL length limit. A chunk of
// 50 tickets also stays far below PostgREST's 1000-row cap.
const TICKET_ID_CHUNK = 50;

// ticket id -> its labels, for the tickets on a page.
export async function listLabelsForTickets(ticketIds: string[]): Promise<Map<string, TeamLabel[]>> {
  const result = new Map<string, TeamLabel[]>();
  if (ticketIds.length === 0) return result;
  const supabase = await createServerSupabaseClient();
  const chunks: string[][] = [];
  for (let i = 0; i < ticketIds.length; i += TICKET_ID_CHUNK) chunks.push(ticketIds.slice(i, i + TICKET_ID_CHUNK));
  const responses = await Promise.all(
    chunks.map((ids) => supabase.from("ticket_labels").select("ticket_id, label:labels(id, name, color)").in("ticket_id", ids)),
  );
  const rows = responses.flatMap(({ data, error }) => {
    if (error) throw new Error(error.message);
    return data as unknown as { ticket_id: string; label: TeamLabel | null }[];
  });
  for (const row of rows) {
    if (!row.label) continue;
    const list = result.get(row.ticket_id) ?? [];
    list.push(row.label);
    result.set(row.ticket_id, list);
  }
  for (const list of result.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

export async function createLabel(name: string, color: LabelColor): Promise<TeamLabel> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("labels").insert({ name, color }).select("id, name, color").single();
  if (error) {
    if (error.code === "23505") throw new LabelNameTakenError();
    throw new Error(error.message);
  }
  return data as TeamLabel;
}

export async function updateLabel(id: string, fields: { name: string; color: LabelColor }): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("labels").update(fields).eq("id", id);
  if (error) {
    if (error.code === "23505") throw new LabelNameTakenError();
    throw new Error(error.message);
  }
}

export async function deleteLabel(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("labels").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// "ticket_gone" when the ticket isn't visible to the caller (RLS refuses the
// insert); "label_gone" when someone deleted the label meanwhile (FK).
// Adding twice / removing an absent label is a no-op.
export type SetTicketLabelResult = "ok" | "ticket_gone" | "label_gone";

export async function setTicketLabel(ticketId: string, labelId: string, on: boolean): Promise<SetTicketLabelResult> {
  const supabase = await createServerSupabaseClient();
  if (on) {
    const { error } = await supabase
      .from("ticket_labels")
      .upsert({ ticket_id: ticketId, label_id: labelId }, { onConflict: "ticket_id,label_id", ignoreDuplicates: true });
    if (error) {
      if (error.code === "42501") return "ticket_gone";
      if (error.code === "23503") return "label_gone";
      throw new Error(error.message);
    }
    return "ok";
  }
  const { error } = await supabase.from("ticket_labels").delete().eq("ticket_id", ticketId).eq("label_id", labelId);
  if (error) throw new Error(error.message);
  return "ok";
}
