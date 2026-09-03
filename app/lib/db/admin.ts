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
  };
  avgFirstResponseMinutes: number | null;
  sampled: boolean;
};

// Aggregated in app code over a bounded select. Runs as the signed-in admin,
// so RLS is what makes this "all tickets" -- an agent calling it would only
// aggregate the rows they can see. Fine at this app's scale; if the table
// grows past the cap this should move to a SQL aggregate.
const MAX_ROWS = 5_000;

function tally(values: (string | null)[]): Record<string, number> {
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
      .select("status, priority, assignee_id, triage_status, created_at, first_response_at")
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
    supabase
      .from("triage_results")
      .select("needs_human_review, latency_ms")
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS),
  ]);

  if (ticketsRes.error) {
    throw new Error(ticketsRes.error.message);
  }
  if (triageRes.error) {
    throw new Error(triageRes.error.message);
  }

  const tickets = ticketsRes.data;
  const triage = triageRes.data;

  const openStatuses = new Set(["new", "triaged", "assigned", "in_progress"]);
  const unassignedOpen = tickets.filter(
    (t) => t.assignee_id === null && openStatuses.has(t.status)
  ).length;

  const triageCounts = tally(tickets.map((t) => t.triage_status));

  const latencies = triage
    .map((r) => r.latency_ms)
    .filter((v): v is number => typeof v === "number");
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;

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
    byPriority: tally(tickets.map((t) => t.priority)),
    unassignedOpen,
    triage: {
      pending: triageCounts.pending ?? 0,
      processing: triageCounts.processing ?? 0,
      completed: triageCounts.completed ?? 0,
      failed: triageCounts.failed ?? 0,
      needsHumanReview: triage.filter((r) => r.needs_human_review).length,
      avgLatencyMs,
    },
    avgFirstResponseMinutes,
    sampled: tickets.length >= MAX_ROWS || triage.length >= MAX_ROWS,
  };
}
