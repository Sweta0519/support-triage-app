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

// Mirrors ticketing.guard_ticket_update()'s transition map exactly. Used to
// decide which buttons/moves to offer and as a server-side check in the
// status actions. The trigger enforces it for agents; admins bypass the
// trigger's map, so the board's move is also conditional on the status it
// read (moveTicketStatus). Keep the two in sync if the map ever changes.
export const ALLOWED_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["assigned", "in_progress"],
  triaged: ["assigned", "in_progress"],
  assigned: ["in_progress", "triaged"],
  in_progress: ["resolved", "assigned"],
  resolved: ["closed", "in_progress"],
  closed: [],
};
