import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import type { AnalyticsTicketRow } from "@/app/lib/analytics";
import { MAX_ROWS } from "@/app/lib/db/admin";

const COLUMNS = `status, created_at, first_response_at,
  triage_state:ticket_triage_state(
    priority, category, team, reviewed_at,
    reviewed_result:triage_results!reviewed_result_id(priority, category, team)
  )`;

// Runs as the signed-in admin, so RLS is what makes this "all tickets" (the
// page is admin-only; an agent would only get the rows they can see).
// `recent` is bounded the same way as getAdminStats(): PostgREST caps a
// response at MAX_ROWS, and `sampled` says so when the cap is hit.
// `waiting` -- open tickets with no first reply yet -- is a separate query
// so the overdue backlog isn't cut off by that cap: the oldest waiting
// tickets are the likeliest to be overdue and the first to fall outside it.
export async function listAnalyticsTickets(): Promise<{
  recent: AnalyticsTicketRow[];
  waiting: AnalyticsTicketRow[];
  sampled: boolean;
}> {
  const supabase = await createServerSupabaseClient();
  const [recentRes, waitingRes] = await Promise.all([
    supabase.from("tickets").select(COLUMNS).order("created_at", { ascending: false }).limit(MAX_ROWS),
    supabase
      .from("tickets")
      .select(COLUMNS)
      .is("first_response_at", null)
      .not("status", "in", "(resolved,closed)")
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS),
  ]);

  if (recentRes.error) {
    throw new Error(recentRes.error.message);
  }
  if (waitingRes.error) {
    throw new Error(waitingRes.error.message);
  }
  const recent = recentRes.data as unknown as AnalyticsTicketRow[];
  const waiting = waitingRes.data as unknown as AnalyticsTicketRow[];
  return { recent, waiting, sampled: recent.length >= MAX_ROWS || waiting.length >= MAX_ROWS };
}
