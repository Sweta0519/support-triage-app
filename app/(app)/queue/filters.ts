// The queue's filter tabs, shared with the ticket page so its back link can
// return to the exact view the agent came from ("Mine", not the whole queue).

export const QUEUE_FILTERS = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Unassigned" },
  { key: "mine", label: "Mine" },
] as const;

export type QueueFilterKey = (typeof QUEUE_FILTERS)[number]["key"];

// Anything unrecognised (a hand-edited URL, a stale link) falls back to the
// full queue rather than erroring.
export function parseQueueFilter(raw: string | undefined): QueueFilterKey {
  return QUEUE_FILTERS.some((f) => f.key === raw) ? (raw as QueueFilterKey) : "all";
}

export function queueHref(filter: QueueFilterKey): string {
  return filter === "all" ? "/queue" : `/queue?filter=${filter}`;
}

export function queueFilterLabel(filter: QueueFilterKey): string {
  return QUEUE_FILTERS.find((f) => f.key === filter)?.label ?? "All";
}
