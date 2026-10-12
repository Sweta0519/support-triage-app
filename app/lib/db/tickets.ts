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

export { ALLOWED_STATUS_TRANSITIONS, type TicketStatus } from "@/app/lib/ticket-status";
import type { TicketStatus } from "@/app/lib/ticket-status";

// AI-derived working state lives in ticketing.ticket_triage_state, a
// staff-only table (RLS). It is embedded into staff reads and comes back as
// null for customers -- the columns simply aren't on anything they can read.
export type TriageState = {
  triage_status: string;
  priority: string | null;
  category: string | null;
  team: string | null;
  // Set once staff confirm or correct the fields; from then on a triage
  // re-run no longer overwrites them.
  reviewed_by: string | null;
  reviewed_at: string | null;
  reviewed_result_id: string | null;
  // When the row last changed (any write) and when the current triage run
  // took its claim: together they tell a stalled run from a live one
  // (app/lib/triage-status.ts).
  updated_at: string;
  claimed_at: string | null;
};

export type TicketSummary = {
  id: string;
  // Short human-readable number (#1042); the UUID stays the key and URL id.
  number: number;
  subject: string;
  status: TicketStatus;
  created_at: string;
};

// The AI signals a queue card shows, from the ticket's latest triage run.
export type QueueTriageSignals = {
  id: string;
  summary: string;
  is_escalation_risk: boolean;
  frustration: number | null;
  needs_human_review: boolean;
};

export type QueueTicketSummary = TicketSummary & {
  assignee_id: string | null;
  first_response_at: string | null;
  triage_state: TriageState | null;
  latest_triage: QueueTriageSignals | null;
};

export type TicketBase = TicketSummary & {
  body: string;
  updated_at: string;
  customer_id: string;
  assignee_id: string | null;
  first_response_at: string | null;
  // The staff member who filed it on the customer's behalf; null when the
  // customer filed it themselves.
  created_by: string | null;
};

export type Ticket = TicketBase & { triage_state: TriageState | null };

const TRIAGE_STATE_EMBED =
  "triage_state:ticket_triage_state(triage_status, priority, category, team, reviewed_by, reviewed_at, reviewed_result_id, updated_at, claimed_at)";
const TICKET_BASE_COLUMNS =
  "id, number, subject, body, status, created_at, updated_at, customer_id, assignee_id, first_response_at, created_by";
const TICKET_COLUMNS = `${TICKET_BASE_COLUMNS}, ${TRIAGE_STATE_EMBED}`;

// Every query here also filters by customer_id explicitly, even though RLS
// already enforces it -- scoping doesn't depend on RLS alone (same defense-
// in-depth pattern as notes-collections' app/lib/db.ts).

export async function listMyTickets(userId: string): Promise<TicketSummary[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .select("id, number, subject, status, created_at")
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

export class StaffTicketError extends Error {
  constructor(readonly reason: "customer_not_found" | "not_allowed") {
    super(`staff_create_ticket refused: ${reason}`);
  }
}

// Staff filing a ticket for a customer (phone, chat, forwarded email).
// ticketing.staff_create_ticket() does every check itself -- staff role,
// the staff rate limit (charged on every call, hit or miss), that the
// email is an existing *customer* account, the table's length limits --
// and records who filed it. It returns only the new ticket's id (or null
// for an unknown email), never anything about the customer.
export async function staffCreateTicket(
  customerEmail: string,
  subject: string,
  body: string,
  assignToMe: boolean
): Promise<{ id: string }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("staff_create_ticket", {
    p_customer_email: customerEmail,
    p_subject: subject,
    p_body: body,
    p_assign_to_me: assignToMe,
  });
  if (error) {
    if (error.code === "42501") throw new StaffTicketError("not_allowed");
    if (error.message.includes("rate_limited")) throw new RateLimitError("staff_create_ticket");
    throw new Error(error.message);
  }
  // null = no customer account with that email. Returned rather than
  // raised so the database keeps the rate-limit charge for the lookup.
  if (data === null) throw new StaffTicketError("customer_not_found");
  return { id: data as string };
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
    .select(
      `id, number, subject, status, created_at, assignee_id, first_response_at, ${TRIAGE_STATE_EMBED},
       latest_triage:triage_results!ticket_id(id, summary, is_escalation_risk, frustration, needs_human_review)`
    )
    .neq("status", "closed")
    .order("created_at", { ascending: true })
    // Only the newest run per ticket. The !ticket_id hint is needed because
    // triage_results also references tickets through duplicate_of.
    .order("created_at", { referencedTable: "triage_results", ascending: false })
    .limit(1, { referencedTable: "triage_results" });

  if (role === "agent") {
    query = query.or(`assignee_id.eq.${userId},assignee_id.is.null`);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  // A to-many embed comes back as an array even with limit(1).
  type Row = Omit<QueueTicketSummary, "latest_triage"> & { latest_triage: QueueTriageSignals[] };
  return (data as unknown as Row[]).map((row) => ({ ...row, latest_triage: row.latest_triage[0] ?? null }));
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
  // Only a ticket nobody has started on moves to "assigned". One that's
  // already in progress or resolved (e.g. unassigned again by an admin)
  // keeps its status: moving it back would lose progress, and the
  // transition map rejects resolved -> assigned outright. Both updates are
  // conditional on assignee_id IS NULL, so the claim stays atomic.
  const fresh = await supabase
    .from("tickets")
    .update({ assignee_id: agentId, status: "assigned" })
    .eq("id", ticketId)
    .is("assignee_id", null)
    .in("status", ["new", "triaged"])
    .select(TICKET_BASE_COLUMNS)
    .maybeSingle();
  if (fresh.error) {
    throw new Error(fresh.error.message);
  }
  if (fresh.data) {
    return fresh.data;
  }

  const started = await supabase
    .from("tickets")
    .update({ assignee_id: agentId })
    .eq("id", ticketId)
    .is("assignee_id", null)
    .not("status", "in", "(new,triaged)")
    .select(TICKET_BASE_COLUMNS)
    .maybeSingle();
  if (started.error) {
    throw new Error(started.error.message);
  }
  // null here means neither WHERE clause matched -- someone else already
  // claimed it (or it doesn't exist/isn't visible), not an error.
  return started.data;
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

// The board's move: applies only if the ticket is still in the status the
// caller saw, so a concurrent change (someone else resolving or closing
// it) isn't overwritten -- for an admin the guard trigger doesn't check
// the transition map, so this is what keeps the move honest. null = it
// changed (or isn't visible).
export async function moveTicketStatus(
  ticketId: string,
  from: TicketStatus,
  to: TicketStatus
): Promise<TicketBase | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .update({ status: to })
    .eq("id", ticketId)
    .eq("status", from)
    .select(TICKET_BASE_COLUMNS)
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
