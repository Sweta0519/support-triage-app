import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { createServiceSupabaseClient } from "@/app/lib/supabase/service";
import type { TicketStatus } from "@/app/lib/db/tickets";

export type Share = {
  id: string;
  token: string;
  revoked: boolean;
  created_at: string;
};

// Staff-side: scoped by the caller's own RLS (can_view_ticket + is_staff),
// same as every other query in app/lib/db/. Only ever the active (not yet
// revoked) share matters for the publish/unpublish UI.
export async function getActiveShareForTicket(ticketId: string): Promise<Share | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("shared_ticket_summaries")
    .select("id, token, revoked, created_at")
    .eq("ticket_id", ticketId)
    .eq("revoked", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Snapshots subject/status/summary at publish time rather than linking
// live -- the public page never has to join tickets or triage_results, so
// there's no way for it to see more than what was true (and chosen) at
// this moment. Runs as the authenticated staff member: the insert policy
// re-checks is_staff() and can_view_ticket(), so this can't publish a
// ticket the caller isn't allowed to see, independent of the app-level
// check in the Server Action that calls this.
//
// A DB-level partial unique index allows only one active (not-revoked)
// share per ticket, so any prior active share is revoked first here --
// otherwise a double-click would 409 on the insert instead of just
// republishing.
export async function publishTicketSummary(
  ticketId: string,
  publishedById: string,
  subject: string,
  status: TicketStatus,
  summary: string
): Promise<Share> {
  const supabase = await createServerSupabaseClient();

  const existing = await getActiveShareForTicket(ticketId);
  if (existing) {
    await revokeShare(ticketId, existing.id);
  }

  const { data, error } = await supabase
    .from("shared_ticket_summaries")
    .insert({ ticket_id: ticketId, published_by: publishedById, subject, status, summary })
    .select("id, token, revoked, created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function revokeShare(ticketId: string, shareId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("shared_ticket_summaries")
    .update({ revoked: true })
    .eq("id", shareId)
    .eq("ticket_id", ticketId);

  if (error) {
    throw new Error(error.message);
  }
}

export type PublicSharedSummary = {
  subject: string;
  status: TicketStatus;
  summary: string;
  created_at: string;
};

export class PublicShareRateLimitError extends Error {
  constructor() {
    super("Too many requests");
    this.name = "PublicShareRateLimitError";
  }
}

// The only reason this table needs a service-role reader at all: `anon` has
// no grant on it (see the migration), so an unauthenticated visitor can
// only ever reach this data through this one function. The token is the
// entire access control -- 128 bits of randomness, exact match, no `like`,
// no listing -- and the select list is hard-coded to the four public-safe
// columns, plus an expiry check. This function must never be changed to
// accept a broader query or a caller-chosen column list.
//
// This is the app's only unauthenticated route, so it's also the only path
// that needs an IP-keyed limiter rather than the auth.uid()-keyed one
// everything else uses -- guessing a *valid* token is already practically
// infeasible at 128 bits, so this bounds cost/availability abuse
// (hammering the endpoint), not data exposure.
export async function getPublicSharedSummary(
  token: string,
  ip: string
): Promise<PublicSharedSummary | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return null;
  }

  const supabase = createServiceSupabaseClient();

  const { data: allowed, error: rateLimitError } = await supabase.rpc(
    "consume_public_share_rate_limit",
    { p_ip: ip }
  );
  if (rateLimitError) {
    throw new Error(rateLimitError.message);
  }
  if (!allowed) {
    throw new PublicShareRateLimitError();
  }

  const { data, error } = await supabase
    .from("shared_ticket_summaries")
    .select("subject, status, summary, created_at")
    .eq("token", token)
    .eq("revoked", false)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}
