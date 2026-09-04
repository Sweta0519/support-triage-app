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
export async function publishTicketSummary(
  ticketId: string,
  publishedById: string,
  subject: string,
  status: TicketStatus,
  summary: string
): Promise<Share> {
  const supabase = await createServerSupabaseClient();
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

// The only reason this table needs a service-role reader at all: `anon` has
// no grant on it (see the migration), so an unauthenticated visitor can
// only ever reach this data through this one function. The token is the
// entire access control -- 128 bits of randomness, exact match, no `like`,
// no listing -- and the select list is hard-coded to the four public-safe
// columns. This function must never be changed to accept a broader query
// or a caller-chosen column list.
export async function getPublicSharedSummary(token: string): Promise<PublicSharedSummary | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) {
    return null;
  }

  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("shared_ticket_summaries")
    .select("subject, status, summary, created_at")
    .eq("token", token)
    .eq("revoked", false)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}
