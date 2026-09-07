// The queue's filter tabs, shared by every page that links into or out of
// the queue (the queue itself, the ticket page's breadcrumb, the triage
// panel's duplicate/related links) so the active tab survives the round
// trip: queue tab -> ticket (?from=<tab>) -> breadcrumb back to that tab.

const FILTER_LABELS = {
  all: "All",
  unassigned: "Unassigned",
  mine: "Mine",
} as const;

export type QueueFilterKey = keyof typeof FILTER_LABELS;

export const QUEUE_FILTERS = (Object.keys(FILTER_LABELS) as QueueFilterKey[]).map((key) => ({
  key,
  label: FILTER_LABELS[key],
}));

// Next hands a repeated query param over as an array; anything unrecognised
// (a hand-edited URL, a stale link) falls back to the full queue rather
// than erroring.
export function parseQueueFilter(raw: string | string[] | undefined): QueueFilterKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value !== undefined && value in FILTER_LABELS ? (value as QueueFilterKey) : "all";
}

export function queueHref(filter: QueueFilterKey): string {
  return filter === "all" ? "/queue" : `/queue?filter=${filter}`;
}

// Where a ticket link from the queue points. "All" is the default, so it is
// left off the URL and parseQueueFilter() recovers it.
export function ticketHref(ticketId: string, filter: QueueFilterKey): string {
  return filter === "all" ? `/tickets/${ticketId}` : `/tickets/${ticketId}?from=${filter}`;
}

// The queue half of a ticket page's breadcrumb: "Queue" always, then the
// tab the agent came from when it wasn't the default "All".
export function queueBreadcrumb(filter: QueueFilterKey): { label: string; href: string }[] {
  const crumbs = [{ label: "Queue", href: queueHref("all") }];
  if (filter !== "all") {
    crumbs.push({ label: FILTER_LABELS[filter], href: queueHref(filter) });
  }
  return crumbs;
}
