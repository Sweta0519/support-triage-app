// Ticket statuses and the allowed transitions between them. Plain values
// with no server-only imports, so client components (the board) can use
// them too; app/lib/db/tickets.ts re-exports them for server code.

export type TicketStatus =
  | "new"
  | "triaged"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "closed";

// Mirrors ticketing.guard_ticket_update()'s transition map exactly -- this
// is only used to decide which buttons to render. The trigger is the real
// enforcement; keep the two in sync if the map ever changes.
export const ALLOWED_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["assigned", "in_progress"],
  triaged: ["assigned", "in_progress"],
  assigned: ["in_progress", "triaged"],
  in_progress: ["resolved", "assigned"],
  resolved: ["closed", "in_progress"],
  closed: [],
};
