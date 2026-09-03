import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import type { AppRole } from "@/app/lib/db/profiles";
import { checkRateLimit } from "@/app/lib/db/rate-limit";

const CREATE_TICKET_LIMIT = 10;
const CREATE_TICKET_WINDOW_SECONDS = 60 * 60;

export type TicketStatus =
  | "new"
  | "triaged"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "closed";

// Mirrors ticketing.guard_ticket_update()'s transition map exactly -- this
// is only used to decide which buttons to render. The trigger is the real
// enforcement; keep the two in sync if the map ever changes.
export const ALLOWED_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["assigned", "in_progress"],
  triaged: ["assigned", "in_progress"],
  assigned: ["in_progress", "triaged"],
  in_progress: ["resolved", "assigned"],
  resolved: ["closed", "in_progress"],
  closed: [],
};

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
  customer_id: string;
  assignee_id: string | null;
};

export type QueueTicketSummary = TicketSummary & { assignee_id: string | null };

const TICKET_COLUMNS =
  "id, subject, body, status, priority, category, team, triage_status, created_at, updated_at, customer_id, assignee_id";

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
    .select(TICKET_COLUMNS)
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
  await checkRateLimit("create_ticket", CREATE_TICKET_LIMIT, CREATE_TICKET_WINDOW_SECONDS);

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

// Queue visibility mirrors the tickets_select RLS policy: agents see
// tickets assigned to them or unassigned; admins see everything. Filtered
// again here in app code (defense in depth), and to "not closed" since a
// working queue shouldn't be cluttered with resolved history.
export async function listQueueTickets(
  userId: string,
  role: AppRole
): Promise<QueueTicketSummary[]> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("tickets")
    .select("id, subject, status, priority, created_at, assignee_id")
    .neq("status", "closed")
    .order("created_at", { ascending: true });

  if (role === "agent") {
    query = query.or(`assignee_id.eq.${userId},assignee_id.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function getTicketForStaff(ticketId: string): Promise<Ticket | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(TICKET_COLUMNS)
    .eq("id", ticketId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Atomic claim: the WHERE clause (not just the RLS policy) requires
// assignee_id to still be null at the moment this UPDATE actually runs. If
// two agents click "Claim" on the same unassigned ticket at once, Postgres
// serializes the two UPDATEs -- whichever commits first flips assignee_id,
// and the second one's WHERE clause no longer matches, so it affects zero
// rows instead of overwriting the first agent's claim.
export async function claimTicket(
  agentId: string,
  ticketId: string
): Promise<Ticket | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .update({ assignee_id: agentId, status: "assigned" })
    .eq("id", ticketId)
    .is("assignee_id", null)
    .select(TICKET_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  // null here means the WHERE clause matched zero rows -- someone else
  // already claimed it (or it doesn't exist/isn't visible), not an error.
  return data;
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus
): Promise<Ticket> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .update({ status })
    .eq("id", ticketId)
    .select(TICKET_COLUMNS)
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}
