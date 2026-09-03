import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import type { AppRole } from "@/app/lib/db/profiles";
import { RateLimitError } from "@/app/lib/db/rate-limit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

export const SUBJECT_MAX_LENGTH = 200;
export const BODY_MAX_LENGTH = 20_000;

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

// AI-derived working state lives in ticketing.ticket_triage_state, a
// staff-only table (RLS). It is embedded into staff reads and comes back as
// null for customers -- the columns simply aren't on anything they can read.
export type TriageState = {
  triage_status: string;
  priority: string | null;
  category: string | null;
  team: string | null;
};

export type TicketSummary = {
  id: string;
  subject: string;
  status: TicketStatus;
  created_at: string;
};

export type QueueTicketSummary = TicketSummary & {
  assignee_id: string | null;
  triage_state: TriageState | null;
};

export type TicketBase = TicketSummary & {
  body: string;
  updated_at: string;
  customer_id: string;
  assignee_id: string | null;
};

export type Ticket = TicketBase & { triage_state: TriageState | null };

const TRIAGE_STATE_EMBED = "triage_state:ticket_triage_state(triage_status, priority, category, team)";
const TICKET_BASE_COLUMNS = "id, subject, body, status, created_at, updated_at, customer_id, assignee_id";
const TICKET_COLUMNS = `${TICKET_BASE_COLUMNS}, ${TRIAGE_STATE_EMBED}`;

// Every query here also filters by customer_id explicitly, even though RLS
// already enforces it -- scoping doesn't depend on RLS alone (same defense-
// in-depth pattern as notes-collections' app/lib/db.ts).

export async function listMyTickets(userId: string): Promise<TicketSummary[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .select("id, subject, status, created_at")
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
  // Without generated DB types supabase-js types the embed as an array; the
  // FK is the child's primary key, so PostgREST returns a single object (or
  // null -- always null for a customer, whose RLS hides the row).
  return data as unknown as Ticket | null;
}

export async function createTicket(
  userId: string,
  subject: string,
  body: string
): Promise<{ id: string }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .insert({ customer_id: userId, subject, body })
    .select("id")
    .single();

  if (error) {
    // The per-user limit is enforced by a BEFORE INSERT trigger in the
    // database (so it also applies to direct Data API calls); this just
    // translates its signal into the friendly form error.
    if (error.message.includes("rate_limited")) {
      throw new RateLimitError("create_ticket");
    }
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
    .select(`id, subject, status, created_at, assignee_id, ${TRIAGE_STATE_EMBED}`)
    .neq("status", "closed")
    .order("created_at", { ascending: true });

  if (role === "agent") {
    query = query.or(`assignee_id.eq.${userId},assignee_id.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return data as unknown as QueueTicketSummary[];
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
  return data as unknown as Ticket | null;
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
): Promise<TicketBase | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .update({ assignee_id: agentId, status: "assigned" })
    .eq("id", ticketId)
    .is("assignee_id", null)
    .select(TICKET_BASE_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  // null here means the WHERE clause matched zero rows -- someone else
  // already claimed it (or it doesn't exist/isn't visible), not an error.
  return data;
}

// Admin reassignment (RLS: only is_admin() may set assignee_id to someone
// other than themselves). `null` unassigns, returning the ticket to the
// shared queue. The guard trigger rejects a non-staff assignee.
export async function assignTicket(
  ticketId: string,
  assigneeId: string | null
): Promise<TicketBase | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .update({ assignee_id: assigneeId })
    .eq("id", ticketId)
    .select(TICKET_BASE_COLUMNS)
    // null = RLS hid the row (or it doesn't exist): a no-op, not a 500.
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function updateTicketStatus(
  ticketId: string,
  status: TicketStatus
): Promise<TicketBase | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .update({ status })
    .eq("id", ticketId)
    .select(TICKET_BASE_COLUMNS)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}
