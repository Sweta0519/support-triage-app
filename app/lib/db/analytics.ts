import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import type { AnalyticsTicketRow } from "@/app/lib/analytics";
import { MAX_ROWS } from "@/app/lib/db/admin";

// Runs as the signed-in admin, so RLS is what makes this "all tickets" (the
// page is admin-only; an agent would only get the rows they can see).
// Bounded the same way as getAdminStats(): PostgREST caps a response at
// MAX_ROWS, and `sampled` says so when the cap is hit.
export async function listAnalyticsTickets(): Promise<{
  rows: AnalyticsTicketRow[];
  sampled: boolean;
}> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("tickets")
    .select(
      `status, created_at, first_response_at,
       triage_state:ticket_triage_state(
         priority, category, team, reviewed_at,
         reviewed_result:triage_results!reviewed_result_id(priority, category, team)
       )`
    )
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    throw new Error(error.message);
  }
  const rows = data as unknown as AnalyticsTicketRow[];
  return { rows, sampled: rows.length >= MAX_ROWS };
}
