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

// ticket id -> its labels, for the tickets on a page.
export async function listLabelsForTickets(ticketIds: string[]): Promise<Map<string, TeamLabel[]>> {
  const result = new Map<string, TeamLabel[]>();
  if (ticketIds.length === 0) return result;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ticket_labels")
    .select("ticket_id, label:labels(id, name, color)")
    .in("ticket_id", ticketIds);
  if (error) throw new Error(error.message);
  for (const row of data as unknown as { ticket_id: string; label: TeamLabel | null }[]) {
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

// true when it took effect; false when the ticket isn't visible to the
// caller (RLS refuses the insert). Adding twice / removing absent is a no-op.
export async function setTicketLabel(ticketId: string, labelId: string, on: boolean): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  if (on) {
    const { error } = await supabase
      .from("ticket_labels")
      .upsert({ ticket_id: ticketId, label_id: labelId }, { onConflict: "ticket_id,label_id", ignoreDuplicates: true });
    if (error) {
      if (error.code === "42501" || error.code === "23503") return false;
      throw new Error(error.message);
    }
    return true;
  }
  const { error } = await supabase.from("ticket_labels").delete().eq("ticket_id", ticketId).eq("label_id", labelId);
  if (error) throw new Error(error.message);
  return true;
}
