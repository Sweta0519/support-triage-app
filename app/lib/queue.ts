// Search, status filter and sort for the staff queue. Pure functions over
// the rows listQueueTickets() returns, so they can be tested without a
// database. The assignment tabs (All / Unassigned / Mine) stay in
// queue-filters.ts; these narrow the list further.

import type { QueueTicketSummary, TicketStatus } from "@/app/lib/db/tickets";
import { computeSla } from "@/app/lib/sla";

// The queue never lists closed tickets (listQueueTickets filters them out).
export const QUEUE_STATUSES = ["new", "triaged", "assigned", "in_progress", "resolved"] as const satisfies readonly TicketStatus[];
export type QueueStatus = (typeof QUEUE_STATUSES)[number];

export const QUEUE_SORTS = {
  sla: "Most urgent",
  newest: "Newest",
  oldest: "Oldest",
} as const;
export type QueueSort = keyof typeof QUEUE_SORTS;

export type QueueView = { status: QueueStatus | "all"; sort: QueueSort; q: string };

function first(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[0] : raw;
}

// Anything unrecognised in the URL falls back to the default view.
export function parseQueueView(params: {
  status?: string | string[];
  sort?: string | string[];
  q?: string | string[];
}): QueueView {
  const status = first(params.status);
  const sort = first(params.sort);
  return {
    status: (QUEUE_STATUSES as readonly string[]).includes(status ?? "") ? (status as QueueStatus) : "all",
    sort: sort !== undefined && sort in QUEUE_SORTS ? (sort as QueueSort) : "sla",
    q: (first(params.q) ?? "").trim().slice(0, 200),
  };
}

// Matches the ticket number, the subject, the AI summary, or the category
// / team, case-insensitively. "#1042" means the number and nothing else,
// so it doesn't also hit subjects that happen to contain those digits.
export function matchesSearch(ticket: QueueTicketSummary, q: string): boolean {
  if (q === "") return true;
  if (q.startsWith("#")) return String(ticket.number) === q.slice(1).trim();
  const needle = q.toLowerCase();
  return (
    String(ticket.number) === needle ||
    ticket.subject.toLowerCase().includes(needle) ||
    (ticket.latest_triage?.summary.toLowerCase().includes(needle) ?? false) ||
    [ticket.triage_state?.category, ticket.triage_state?.team].some(
      (value) => value != null && value.replace(/_/g, " ").includes(needle)
    )
  );
}

// "Most urgent": tickets still waiting for a first reply come first,
// ordered by time left (most overdue at the top); then everything already
// answered or without an SLA, oldest first.
function urgencyKey(ticket: QueueTicketSummary, now: Date): [number, number] {
  const sla = computeSla(ticket, now);
  if (sla && "remainingMs" in sla) return [0, sla.remainingMs];
  return [1, new Date(ticket.created_at).getTime()];
}

export function sortQueue(tickets: QueueTicketSummary[], sort: QueueSort, now: Date = new Date()): QueueTicketSummary[] {
  const byCreated = (a: QueueTicketSummary, b: QueueTicketSummary) =>
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  const sorted = [...tickets];
  if (sort === "newest") return sorted.sort((a, b) => byCreated(b, a));
  if (sort === "oldest") return sorted.sort(byCreated);
  return sorted.sort((a, b) => {
    const [ga, ka] = urgencyKey(a, now);
    const [gb, kb] = urgencyKey(b, now);
    return ga - gb || ka - kb;
  });
}

// Frustration is 1-5 from triage; only the high end is worth a chip.
export function isFrustrated(frustration: number | null): boolean {
  return frustration !== null && frustration >= 4;
}
