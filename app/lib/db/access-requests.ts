import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

// "Get in touch" (SUP-58). The sign-up form keeps the visitor's answers in
// their account's metadata; the first time they're signed in, this files them
// as one access-request ticket (ticketing.file_access_request() does it once,
// as the customer, under the ticket rate limit). Null when there was nothing
// to file: no request, already filed, or not a customer.

export async function fileAccessRequestIfPending(): Promise<{ id: string; number: number } | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("file_access_request");
  if (error) {
    throw new Error(error.message);
  }
  const row = (data as { ticket_id: string; ticket_number: number }[] | null)?.[0];
  return row ? { id: row.ticket_id, number: row.ticket_number } : null;
}

// ---- Admins: reviewing and deciding requests (SUP-68) ---------------------

export type AccessRequestStatus = "pending" | "granted" | "declined";

export type AccessRequest = {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  requestedAt: string;
  status: AccessRequestStatus;
  ticket: { id: string; number: number; body: string } | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

// How many requests are waiting, for the admin sidebar. Only admins can see
// other people's profiles (RLS), so for anyone else this is 0.
export async function countPendingAccessRequests(): Promise<number> {
  const supabase = await createServerSupabaseClient();
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("access_request_status", "pending");
  if (error) {
    throw new Error(error.message);
  }
  return count ?? 0;
}

// Every request, newest first: the pending ones and the history. Admins
// only, through RLS on profiles and tickets.
export async function listAccessRequests(): Promise<AccessRequest[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, email, full_name, access_requested_at, access_request_status, access_decided_by, access_decided_at, membership:workspace_members!inner(role), ticket:tickets!profiles_access_request_ticket_id_fkey(id, number, body)"
    )
    .not("access_request_status", "is", null)
    .order("access_requested_at", { ascending: false })
    // The page shows the most recent; older history isn't needed there.
    .limit(200);
  if (error) {
    throw new Error(error.message);
  }
  type Row = {
    id: string;
    email: string;
    full_name: string | null;
    membership: { role: string };
    access_requested_at: string;
    access_request_status: AccessRequestStatus;
    access_decided_by: string | null;
    access_decided_at: string | null;
    ticket: { id: string; number: number; body: string } | null;
  };
  return (data as unknown as Row[]).map((r) => ({
    userId: r.id,
    email: r.email,
    name: r.full_name,
    role: r.membership.role,
    requestedAt: r.access_requested_at,
    status: r.access_request_status,
    ticket: r.ticket,
    decidedBy: r.access_decided_by,
    decidedAt: r.access_decided_at,
  }));
}

export class AccessDecisionError extends Error {
  constructor(readonly reason: "not_pending" | "not_allowed" | "own_request" | "rate_limited") {
    super(`decide_access_request refused: ${reason}`);
  }
}

// Grants (makes them an agent) or declines a pending request, replying on
// and resolving its ticket: ticketing.decide_access_request() does it all,
// and checks the caller is an admin.
export async function decideAccessRequest(userId: string, grant: boolean): Promise<"granted" | "declined"> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("decide_access_request", { p_user: userId, p_grant: grant });
  if (error) {
    // The function's own refusals, by their exact text (checked before the
    // shared 42501 code, which own_request also uses).
    if (error.message === "not_pending") throw new AccessDecisionError("not_pending");
    if (error.message === "own_request") throw new AccessDecisionError("own_request");
    // The reply counts against the admin's comment limit.
    if (error.message.startsWith("rate_limited")) throw new AccessDecisionError("rate_limited");
    if (error.code === "42501") throw new AccessDecisionError("not_allowed");
    throw new Error(error.message);
  }
  return data as "granted" | "declined";
}

// The pending access request this ticket belongs to, if any, for the
// admin's buttons on the ticket page. Admins only (RLS on profiles).
export async function getPendingAccessRequestForTicket(ticketId: string): Promise<{ userId: string } | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("access_request_ticket_id", ticketId)
    .eq("access_request_status", "pending")
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data ? { userId: data.id } : null;
}
