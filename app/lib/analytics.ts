// Aggregations behind the admin analytics page. Pure functions over rows
// that app/lib/db/analytics.ts fetches, so the numbers can be tested
// without a database.

import type { TicketStatus } from "@/app/lib/db/tickets";
import { computeSla } from "@/app/lib/sla";
import { TRIAGE_PRIORITIES, type TriagePriority } from "@/app/lib/triage-fields";

type TriageFields = { priority: string | null; category: string | null; team: string | null };

export type AnalyticsTicketRow = {
  status: TicketStatus;
  created_at: string;
  first_response_at: string | null;
  triage_state:
    | (TriageFields & {
        reviewed_at: string | null;
        // The AI run the reviewer was shown; null for a review made with no
        // AI run (a "manual" triage) or for an unreviewed ticket.
        reviewed_result: TriageFields | null;
      })
    | null;
};

export const VOLUME_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;
const FIELDS = ["priority", "category", "team"] as const;
type Field = (typeof FIELDS)[number];

export type Analytics = {
  ticketCount: number;
  // Tickets opened per UTC day, oldest first, today last.
  volume: { day: string; count: number }[];
  sla: {
    byPriority: {
      priority: TriagePriority;
      answered: number;
      met: number;
      openAtRisk: number;
      openBreached: number;
    }[];
    answered: number;
    met: number;
  };
  triage: {
    // Tickets whose triage state staff have confirmed or corrected.
    reviewed: number;
    // Of those, how the reviewer's values compare with the AI run they saw
    // ("manual": no AI run, or one with no fields to compare).
    confirmed: number;
    corrected: number;
    manual: number;
    fieldAgreement: { field: Field; agreed: number; compared: number }[];
    // priorityMatrix[ai][staff] = tickets, over AI-reviewed tickets.
    priorityMatrix: Record<TriagePriority, Record<TriagePriority, number>>;
  };
};

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// `rows` are the recent tickets every figure is computed from, except the
// open at-risk / overdue counts, which use `waiting`: the open tickets still
// without a first reply, fetched separately so the backlog is complete even
// when `rows` is a sample (the oldest waiting tickets are the likeliest to
// be overdue and the likeliest to fall outside it). Defaults to `rows`.
export function computeAnalytics(
  rows: AnalyticsTicketRow[],
  now: Date = new Date(),
  waiting: AnalyticsTicketRow[] = rows
): Analytics {
  // Volume: one bucket per UTC day, including days with no tickets.
  const todayMs = Date.parse(utcDay(now));
  const volume = Array.from({ length: VOLUME_DAYS }, (_, i) => ({
    day: utcDay(new Date(todayMs - (VOLUME_DAYS - 1 - i) * DAY_MS)),
    count: 0,
  }));
  const volumeIndex = new Map(volume.map((bucket, i) => [bucket.day, i]));
  for (const row of rows) {
    // Parsed rather than sliced, so a timestamp with a non-UTC offset still
    // lands on its UTC day.
    const i = volumeIndex.get(utcDay(new Date(row.created_at)));
    if (i !== undefined) volume[i].count += 1;
  }

  // SLA, grouped by the priority the SLA itself used (unprioritised -> normal).
  const byPriority = new Map(
    TRIAGE_PRIORITIES.map((priority) => [
      priority,
      { priority, answered: 0, met: 0, openAtRisk: 0, openBreached: 0 },
    ])
  );
  for (const row of rows) {
    const sla = computeSla(row, now);
    if (sla?.state !== "met" && sla?.state !== "missed") continue;
    const bucket = byPriority.get(sla.priority)!;
    bucket.answered += 1;
    if (sla.state === "met") bucket.met += 1;
  }
  for (const row of waiting) {
    const sla = computeSla(row, now);
    if (!sla) continue;
    const bucket = byPriority.get(sla.priority)!;
    if (sla.state === "at_risk") bucket.openAtRisk += 1;
    else if (sla.state === "breached") bucket.openBreached += 1;
  }
  const slaRows = [...byPriority.values()];

  // Triage quality: the reviewer's values against the AI run they reviewed.
  let reviewed = 0;
  let confirmed = 0;
  let corrected = 0;
  let manual = 0;
  const agreement = Object.fromEntries(FIELDS.map((f) => [f, { agreed: 0, compared: 0 }])) as Record<
    Field,
    { agreed: number; compared: number }
  >;
  const priorityMatrix = Object.fromEntries(
    TRIAGE_PRIORITIES.map((ai) => [ai, Object.fromEntries(TRIAGE_PRIORITIES.map((s) => [s, 0]))])
  ) as Analytics["triage"]["priorityMatrix"];

  for (const row of rows) {
    const state = row.triage_state;
    if (!state?.reviewed_at) continue;
    reviewed += 1;
    const ai = state.reviewed_result;
    const compared = ai ? FIELDS.filter((field) => ai[field] !== null) : [];
    if (!ai || compared.length === 0) {
      manual += 1;
      continue;
    }
    let allAgree = true;
    for (const field of compared) {
      agreement[field].compared += 1;
      if (ai[field] === state[field]) agreement[field].agreed += 1;
      else allAgree = false;
    }
    if (allAgree) confirmed += 1;
    else corrected += 1;
    // Both come from the ticket_priority enum, so they index the matrix.
    if (ai.priority && state.priority) {
      priorityMatrix[ai.priority as TriagePriority][state.priority as TriagePriority] += 1;
    }
  }

  return {
    ticketCount: rows.length,
    volume,
    sla: {
      byPriority: slaRows,
      answered: slaRows.reduce((sum, r) => sum + r.answered, 0),
      met: slaRows.reduce((sum, r) => sum + r.met, 0),
    },
    triage: {
      reviewed,
      confirmed,
      corrected,
      manual,
      fieldAgreement: FIELDS.map((field) => ({ field, ...agreement[field] })),
      priorityMatrix,
    },
  };
}

// "83%", or "-" when there's nothing to divide by -- never a made-up 0%.
// Never rounds to a misleading extreme: 199/200 is ">99%", not "100%", and
// 1/300 is "<1%", not "0%".
export function formatRate(part: number, whole: number): string {
  if (whole <= 0) return "-";
  const pct = Math.round((part / whole) * 100);
  if (pct === 100 && part < whole) return ">99%";
  if (pct === 0 && part > 0) return "<1%";
  return `${pct}%`;
}
