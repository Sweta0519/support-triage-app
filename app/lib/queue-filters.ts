// The queue's filter tabs, shared by every page that links into or out of
// the queue (the queue itself, the ticket page's back link, the triage
// panel's duplicate/related links) so the active tab survives the round
// trip: queue tab -> ticket (?from=<tab>) -> back to that same tab.

export const QUEUE_FILTERS = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Unassigned" },
  { key: "mine", label: "Mine" },
] as const;

export type QueueFilterKey = (typeof QUEUE_FILTERS)[number]["key"];

const BACK_LABELS: Record<QueueFilterKey, string> = {
  all: "Queue",
  unassigned: "Queue: Unassigned",
  mine: "Queue: Mine",
};

// Next hands a repeated query param over as an array; anything unrecognised
// (a hand-edited URL, a stale link) falls back to the full queue rather
// than erroring.
export function parseQueueFilter(raw: string | string[] | undefined): QueueFilterKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return QUEUE_FILTERS.find((f) => f.key === value)?.key ?? "all";
}

export function queueHref(filter: QueueFilterKey): string {
  return filter === "all" ? "/queue" : `/queue?filter=${filter}`;
}

// Where a ticket link from the queue points. "All" is the default, so it is
// left off the URL and parseQueueFilter() recovers it.
export function ticketHref(ticketId: string, filter: QueueFilterKey): string {
  return filter === "all" ? `/tickets/${ticketId}` : `/tickets/${ticketId}?from=${filter}`;
}

// The ticket page's back link, for staff.
export function queueBackLink(filter: QueueFilterKey): { href: string; label: string } {
  return { href: queueHref(filter), label: BACK_LABELS[filter] };
}
