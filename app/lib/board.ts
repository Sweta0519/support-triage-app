// The staff triage board: tickets in columns by status. Pure helpers, so
// the move rules can be tested without a database and shared by the
// client board and the Server Action.

import { ALLOWED_STATUS_TRANSITIONS, type TicketStatus } from "@/app/lib/ticket-status";

// Closed tickets aren't on the board (the queue doesn't list them), but a
// resolved ticket can still be moved to Closed from its menu.
export const BOARD_COLUMNS = ["new", "triaged", "assigned", "in_progress", "resolved"] as const satisfies readonly TicketStatus[];

export const COLUMN_LABELS: Record<TicketStatus, string> = {
  new: "New",
  triaged: "Triaged",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

// Where a ticket may move from its current status: exactly the transition
// map the database guard enforces (ALLOWED_STATUS_TRANSITIONS mirrors it).
export function boardTargets(status: TicketStatus): TicketStatus[] {
  return ALLOWED_STATUS_TRANSITIONS[status];
}

export function canMove(from: TicketStatus, to: TicketStatus): boolean {
  return from !== to && boardTargets(from).includes(to);
}

// Moving an unassigned ticket into Assigned or In progress means taking it:
// it's claimed for the person moving it first, so nothing ends up "in
// progress" with nobody on it.
export function moveClaimsTicket(assigneeId: string | null, to: TicketStatus): boolean {
  return assigneeId === null && (to === "assigned" || to === "in_progress");
}
