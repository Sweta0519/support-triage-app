import "server-only";

import { canMove, COLUMN_LABELS, moveClaimsTicket } from "@/app/lib/board";
import { claimTicket, DailyCapError, getTicketForStaff, moveTicketStatus, type Ticket } from "@/app/lib/db/tickets";
import { DAILY_CAP_SELF_MESSAGE } from "@/app/lib/workload";
import type { TicketStatus } from "@/app/lib/ticket-status";

export type MoveResult = { ok: true } | { ok: false; error: string };

// A staff member moving a ticket to another status -- a board drag or the
// queue card's "Move to…". Reads the ticket as the caller first (RLS:
// agents only see their own and unassigned tickets), checks the move
// against the same transition map the database guard enforces, and claims
// an unassigned ticket when it's moved into Assigned or In progress. The
// guard trigger still has the final say.
// `seen`: the ticket as the caller just read it, to save reading it again.
export async function moveTicketAs(
  staffId: string,
  ticketId: string,
  target: TicketStatus,
  seen?: Ticket
): Promise<MoveResult> {
  try {
    const ticket = seen ?? (await getTicketForStaff(ticketId));
    if (!ticket) {
      return { ok: false, error: "This ticket is no longer available to you." };
    }
    if (!canMove(ticket.status, target)) {
      return { ok: false, error: `A ticket can't go from ${COLUMN_LABELS[ticket.status]} to ${COLUMN_LABELS[target]}.` };
    }

    let status = ticket.status;
    if (moveClaimsTicket(ticket.assignee_id, target)) {
      const claimed = await claimTicket(staffId, ticketId);
      if (!claimed) {
        return { ok: false, error: "Someone else claimed this ticket first." };
      }
      status = claimed.status;
    }
    if (status !== target) {
      // Conditional on the status just seen: a concurrent change wins and
      // the mover is told, rather than silently overwriting it.
      const moved = await moveTicketStatus(ticketId, status, target);
      if (!moved) {
        return {
          ok: false,
          error:
            status !== ticket.status
              ? "Claimed for you, but its status changed meanwhile. The page now shows where it is."
              : "This ticket changed while you were moving it. The page now shows its current state.",
        };
      }
    }
    return { ok: true };
  } catch (err) {
    // Moving an unassigned ticket claims it, and the daily cap can refuse
    // that (SUP-77).
    if (err instanceof DailyCapError) return { ok: false, error: DAILY_CAP_SELF_MESSAGE };
    // e.g. the guard trigger refused the transition after a concurrent
    // change. The refreshed page shows the real state.
    return { ok: false, error: "That move couldn't be saved. The page now shows the ticket's current state." };
  }
}
