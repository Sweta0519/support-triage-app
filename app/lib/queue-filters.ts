// The queue's filter tabs, shared by every page that links into or out of
// the queue (the queue itself, the ticket page's breadcrumb, the triage
// panel's duplicate/related links) so the active tab survives the round
// trip: queue tab -> ticket (?from=<tab>) -> breadcrumb back to that tab.

const FILTER_LABELS = {
  all: "All",
  unassigned: "Unassigned",
  mine: "Mine",
  // The viewer's own follow-up flags (SUP-27).
  flagged: "Flagged",
} as const;

export type QueueFilterKey = keyof typeof FILTER_LABELS;

export const QUEUE_FILTERS = (Object.keys(FILTER_LABELS) as QueueFilterKey[]).map((key) => ({
  key,
  label: FILTER_LABELS[key],
}));

// Next hands a repeated query param over as an array; anything unrecognised
// (a hand-edited URL, a stale link) falls back to `fallback` -- the full
// queue, or on the queue page itself the user's default tab -- rather than
// erroring.
export function parseQueueFilter(
  raw: string | string[] | undefined,
  fallback: QueueFilterKey = "all"
): QueueFilterKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  // Object.hasOwn, not `in`: "?from=toString" must not count as a tab.
  return isQueueFilter(value) ? value : fallback;
}

export function isQueueFilter(value: unknown): value is QueueFilterKey {
  return typeof value === "string" && Object.hasOwn(FILTER_LABELS, value);
}

// Always names the tab: a bare /queue opens on the user's own default tab
// (account settings), which may not be the one meant here. Bare /queue is
// for "my queue, as I set it up" (the sidebar, the dashboard card).
export function queueHref(filter: QueueFilterKey): string {
  return `/queue?filter=${filter}`;
}

// Where a ticket link from the queue points. "All" is the default, so it is
// left off the URL and parseQueueFilter() recovers it.
export function ticketHref(ticketId: string, filter: QueueFilterKey): string {
  return filter === "all" ? `/tickets/${ticketId}` : `/tickets/${ticketId}?from=${filter}`;
}

// Where a queue-card form may send the agent back to: only a same-origin
// /queue URL with a query string free of slashes, backslashes and line
// breaks. Anything else (e.g. "//evil.example", "/queue\\evil") falls
// back to the plain queue, so a tampered form can't redirect off-site.
export function safeQueueReturn(raw: string): string {
  return /^\/queue(\?[^/\\\r\n]*)?$/.test(raw) ? raw : "/queue";
}

// The queue half of a ticket page's breadcrumb: "Queue" (the whole queue)
// always, then the tab the agent came from when it wasn't "All".
export function queueBreadcrumb(filter: QueueFilterKey): { label: string; href: string }[] {
  const crumbs = [{ label: "Queue", href: queueHref("all") }];
  if (filter !== "all") {
    crumbs.push({ label: FILTER_LABELS[filter], href: queueHref(filter) });
  }
  return crumbs;
}
