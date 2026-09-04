import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

export type AdminStats = {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  unassignedOpen: number;
  triage: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    needsHumanReview: number;
    avgLatencyMs: number | null;
    totalCostUsd: number;
  };
  avgFirstResponseMinutes: number | null;
  sampled: boolean;
};

// Aggregated in app code over a bounded select. Runs as the signed-in admin,
// so RLS is what makes this "all tickets" -- an agent calling it would only
// aggregate the rows they can see. PostgREST caps any single response at
// 1,000 rows (the project's max_rows), so asking for more would silently
// return 1,000 anyway; match it so `sampled` is truthful. If the table grows
// past this, move the aggregation to a SQL function.
export const MAX_ROWS = 1_000;

type TicketRow = {
  status: string;
  assignee_id: string | null;
  created_at: string;
  first_response_at: string | null;
  triage_state: { triage_status: string; priority: string | null } | null;
};

type TriageRow = { needs_human_review: boolean; latency_ms: number | null; cost_usd: number | null };

function tally(values: (string | null | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const key = v ?? "unset";
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export async function getAdminStats(): Promise<AdminStats> {
  const supabase = await createServerSupabaseClient();

  const [ticketsRes, triageRes] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        "status, assignee_id, created_at, first_response_at, triage_state:ticket_triage_state(triage_status, priority)"
      )
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from("triage_results")
      .select("needs_human_review, latency_ms, cost_usd")
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
  ]);

  if (ticketsRes.error) {
    throw new Error(ticketsRes.error.message);
  }
  if (triageRes.error) {
    throw new Error(triageRes.error.message);
  }

  const tickets = ticketsRes.data as unknown as TicketRow[];
  const triage = triageRes.data as TriageRow[];

  const openStatuses = new Set(["new", "triaged", "assigned", "in_progress"]);
  const unassignedOpen = tickets.filter(
    (t) => t.assignee_id === null && openStatuses.has(t.status)
  ).length;

  const triageCounts = tally(tickets.map((t) => t.triage_state?.triage_status));

  const latencies = triage
    .map((r) => r.latency_ms)
    .filter((v): v is number => typeof v === "number");
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;

  const totalCostUsd = triage.reduce((sum, r) => sum + (r.cost_usd ?? 0), 0);

  const responseMinutes = tickets
    .filter((t) => t.first_response_at)
    .map(
      (t) =>
        (new Date(t.first_response_at as string).getTime() - new Date(t.created_at).getTime()) /
        60_000
    )
    .filter((m) => Number.isFinite(m) && m >= 0);
  const avgFirstResponseMinutes =
    responseMinutes.length > 0
      ? Math.round(responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length)
      : null;

  return {
    total: tickets.length,
    byStatus: tally(tickets.map((t) => t.status)),
    byPriority: tally(tickets.map((t) => t.triage_state?.priority)),
    unassignedOpen,
    triage: {
      pending: triageCounts.pending ?? 0,
      processing: triageCounts.processing ?? 0,
      completed: triageCounts.completed ?? 0,
      failed: triageCounts.failed ?? 0,
      needsHumanReview: triage.filter((r) => r.needs_human_review).length,
      avgLatencyMs,
      totalCostUsd,
    },
    avgFirstResponseMinutes,
    sampled: tickets.length >= MAX_ROWS || triage.length >= MAX_ROWS,
  };
}
