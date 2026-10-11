// Aggregations behind the admin analytics page. Pure functions over rows
// that app/lib/db/analytics.ts fetches, so the numbers can be tested
// without a database.

import type { TicketStatus } from "@/app/lib/db/tickets";
import { isFrustrated } from "@/app/lib/queue";
import { computeSla } from "@/app/lib/sla";
import { TRIAGE_PRIORITIES, type TriagePriority } from "@/app/lib/triage-fields";

type TriageFields = { priority: string | null; category: string | null; team: string | null };

export type AnalyticsTicketRow = {
  status: TicketStatus;
  created_at: string;
  first_response_at: string | null;
  assignee_id: string | null;
  // From the ticket's newest triage run; null before triage has run.
  latest_triage: { frustration: number | null; is_escalation_risk: boolean } | null;
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
// open at-risk / overdue counts, which use `open`: every open ticket,
// fetched separately so the backlog is complete even when `rows` is a
// sample (the oldest waiting tickets are the likeliest to be overdue and
// the likeliest to fall outside it). Defaults to `rows`.
export function computeAnalytics(
  rows: AnalyticsTicketRow[],
  now: Date = new Date(),
  open: AnalyticsTicketRow[] = rows
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
  // Answered tickets come back met/missed and aren't counted here.
  for (const row of open) {
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

// A customer's CSAT rating as the analytics page reads it (see
// app/lib/db/ratings.ts).
export type CsatRating = {
  ticket_id: string;
  score: number;
  comment: string | null;
  // The assignee credited when the rating was given; null if unassigned.
  agent_id: string | null;
  created_at: string;
  // Last change: a re-rating counts as recent.
  updated_at: string;
  ticket: { number: number; subject: string; status: TicketStatus } | null;
};

export type TeamRow = {
  // null: the Unassigned row.
  assigneeId: string | null;
  label: string;
  // Workload now, over every open ticket.
  open: number;
  atRisk: number;
  overdue: number;
  // Over the recent sample: tickets this person resolved or closed, and
  // their first replies (met = within the SLA target).
  resolved: number;
  repliesOnTime: number;
  repliesAnswered: number;
  // Over all ratings credited to them.
  csatSum: number;
  csatCount: number;
};

// One row per staff member: current workload, recent output, and CSAT.
// Every listed staff member gets a row, even with nothing assigned; anyone
// holding tickets or ratings who isn't in `staff` (e.g. demoted since)
// still shows, as "Former staff member" plus the start of their id so two
// of them stay distinguishable. Most open work first, Unassigned last.
export function computeTeamPerformance({
  open,
  recent,
  ratings,
  staff,
  now = new Date(),
}: {
  open: AnalyticsTicketRow[];
  recent: AnalyticsTicketRow[];
  ratings: CsatRating[];
  staff: { id: string; label: string }[];
  now?: Date;
}): TeamRow[] {
  const empty = (assigneeId: string | null, label: string): TeamRow => ({
    assigneeId,
    label,
    open: 0,
    atRisk: 0,
    overdue: 0,
    resolved: 0,
    repliesOnTime: 0,
    repliesAnswered: 0,
    csatSum: 0,
    csatCount: 0,
  });
  const rows = new Map<string | null, TeamRow>(staff.map((s) => [s.id, empty(s.id, s.label)]));
  rows.set(null, empty(null, "Unassigned"));
  // Someone no longer on staff only gets a row while they still hold open
  // tickets; their past output and ratings don't add rows of their own.
  const rowFor = (id: string | null, create: boolean) => {
    let row = rows.get(id);
    if (!row && create) {
      row = empty(id, `Former staff member (${(id ?? "").slice(0, 8)})`);
      rows.set(id, row);
    }
    return row;
  };

  for (const ticket of open) {
    if (ticket.status === "resolved" || ticket.status === "closed") continue;
    const row = rowFor(ticket.assignee_id, true)!;
    row.open += 1;
    const state = computeSla(ticket, now)?.state;
    if (state === "at_risk") row.atRisk += 1;
    else if (state === "breached") row.overdue += 1;
  }
  for (const ticket of recent) {
    if (ticket.assignee_id === null) continue;
    const row = rowFor(ticket.assignee_id, false);
    if (!row) continue;
    if (ticket.status === "resolved" || ticket.status === "closed") row.resolved += 1;
    const state = computeSla(ticket, now)?.state;
    if (state === "met" || state === "missed") {
      row.repliesAnswered += 1;
      if (state === "met") row.repliesOnTime += 1;
    }
  }
  for (const rating of countableRatings(ratings)) {
    if (rating.agent_id === null) continue;
    const row = rowFor(rating.agent_id, false);
    if (!row) continue;
    row.csatSum += rating.score;
    row.csatCount += 1;
  }

  const unassigned = rows.get(null)!;
  rows.delete(null);
  return [...[...rows.values()].sort((a, b) => b.open - a.open || a.label.localeCompare(b.label)), unassigned];
}

// "4.6", or null below the minimum number of ratings (shown as "-").
export function formatCsat(sum: number, count: number, minimum: number): string | null {
  return count >= minimum && count > 0 ? (sum / count).toFixed(1) : null;
}

export type CsatSummary = {
  average: string | null;
  count: number;
  // Ratings of tickets nobody was assigned to when rated: in the team
  // average, but in no person's row.
  unassigned: number;
  // Ratings of 1-2 stars, newest first, for an admin to follow up.
  recentLow: CsatRating[];
};

// A rating counts while its ticket is resolved or closed: if the ticket
// was reopened it's being worked again, and the old rating waits until the
// customer rates the new resolution.
function countableRatings(ratings: CsatRating[]): CsatRating[] {
  return ratings.filter((r) => !r.ticket || r.ticket.status === "resolved" || r.ticket.status === "closed");
}

export function computeCsat(ratings: CsatRating[], lowLimit = 5): CsatSummary {
  const counted = countableRatings(ratings);
  const sum = counted.reduce((total, r) => total + r.score, 0);
  return {
    average: formatCsat(sum, counted.length, 1),
    count: counted.length,
    unassigned: counted.filter((r) => r.agent_id === null).length,
    recentLow: counted
      .filter((r) => r.score <= 2)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .slice(0, lowLimit),
  };
}

export type Sentiment = {
  // From the AI's frustration score (1-5) on each ticket's newest triage run.
  calm: number; // 1-2
  neutral: number; // 3
  frustrated: number; // 4-5
  unscored: number; // not triaged yet, or the run has no score
  // Frustrated customers still without a first reply, and tickets the AI
  // flagged as likely to escalate.
  frustratedWaiting: number;
  escalationRisk: number;
};

// Over open tickets only, so every number on the card describes the same
// set -- the customers someone still has to deal with.
export function computeSentiment(open: AnalyticsTicketRow[]): Sentiment {
  const out: Sentiment = { calm: 0, neutral: 0, frustrated: 0, unscored: 0, frustratedWaiting: 0, escalationRisk: 0 };
  for (const row of open) {
    if (row.status === "resolved" || row.status === "closed") continue;
    const score = row.latest_triage?.frustration ?? null;
    if (score === null) out.unscored += 1;
    // "Frustrated" uses the same threshold as the queue card's chip.
    else if (isFrustrated(score)) out.frustrated += 1;
    else if (score === 3) out.neutral += 1;
    else out.calm += 1;
    if (row.latest_triage?.is_escalation_risk) out.escalationRisk += 1;
    if (row.first_response_at === null && isFrustrated(score)) out.frustratedWaiting += 1;
  }
  return out;
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
