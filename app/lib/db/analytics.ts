import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import type { AnalyticsTicketRow } from "@/app/lib/analytics";
import { MAX_ROWS } from "@/app/lib/db/admin";

const COLUMNS = `status, created_at, first_response_at, assignee_id,
  latest_triage:triage_results!triage_results_ticket_workspace_fkey(frustration, is_escalation_risk),
  triage_state:ticket_triage_state(
    priority, category, team, reviewed_at, learning_excluded_at,
    reviewed_result:triage_results!reviewed_result_id(priority, category, team)
  )`;

// Runs as the signed-in admin, so RLS is what makes this "all tickets" (the
// page is admin-only; an agent would only get the rows they can see).
// `recent` is bounded the same way as getAdminStats(): PostgREST caps a
// response at MAX_ROWS, and `sampled` says so when the cap is hit.
// `open` -- every ticket not resolved or closed -- is a separate query so
// the overdue backlog and agent workload aren't cut off by that cap: the
// oldest waiting tickets are the likeliest to be overdue and the first to
// fall outside it.
export async function listAnalyticsTickets(): Promise<{
  recent: AnalyticsTicketRow[];
  open: AnalyticsTicketRow[];
  sampled: boolean;
}> {
  const supabase = await createServerSupabaseClient();
  // Only each ticket's newest triage run. The foreign-key hint is needed
  // because triage_results also references tickets through duplicate_of;
  // it names the constraint, since both keys include workspace_id.
  const newestRun = { referencedTable: "triage_results", ascending: false } as const;
  const [recentRes, openRes] = await Promise.all([
    supabase
      .from("tickets")
      .select(COLUMNS)
      .order("created_at", { ascending: false })
      .order("created_at", newestRun)
      .limit(1, { referencedTable: "triage_results" })
      .limit(MAX_ROWS),
    supabase
      .from("tickets")
      .select(COLUMNS)
      .not("status", "in", "(resolved,closed)")
      .order("created_at", { ascending: true })
      .order("created_at", newestRun)
      .limit(1, { referencedTable: "triage_results" })
      .limit(MAX_ROWS),
  ]);

  if (recentRes.error) {
    throw new Error(recentRes.error.message);
  }
  if (openRes.error) {
    throw new Error(openRes.error.message);
  }
  // A to-many embed comes back as an array even with limit(1).
  type Row = Omit<AnalyticsTicketRow, "latest_triage"> & { latest_triage: AnalyticsTicketRow["latest_triage"][] };
  const flatten = (rows: Row[]): AnalyticsTicketRow[] =>
    rows.map((row) => ({ ...row, latest_triage: row.latest_triage[0] ?? null }));
  const recent = flatten(recentRes.data as unknown as Row[]);
  const open = flatten(openRes.data as unknown as Row[]);
  return { recent, open, sampled: recent.length >= MAX_ROWS || open.length >= MAX_ROWS };
}
