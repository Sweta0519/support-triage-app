import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

export type TicketStatus =
  | "new"
  | "triaged"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "closed";

export type TicketSummary = {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: string | null;
  created_at: string;
};

export type Ticket = TicketSummary & {
  body: string;
  category: string | null;
  team: string | null;
  triage_status: string;
  updated_at: string;
};

// Every query here also filters by customer_id explicitly, even though RLS
// already enforces it -- scoping doesn't depend on RLS alone (same defense-
// in-depth pattern as notes-collections' app/lib/db.ts).

export async function listMyTickets(userId: string): Promise<TicketSummary[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .select("id, subject, status, priority, created_at")
    .eq("customer_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function getMyTicketById(
  userId: string,
  ticketId: string
): Promise<Ticket | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(
      "id, subject, body, status, priority, category, team, triage_status, created_at, updated_at"
    )
    .eq("customer_id", userId)
    .eq("id", ticketId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function createTicket(
  userId: string,
  subject: string,
  body: string
): Promise<TicketSummary> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .insert({ customer_id: userId, subject, body })
    .select("id, subject, status, priority, created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}
