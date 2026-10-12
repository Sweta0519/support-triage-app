import { requireStaff } from "@/app/lib/auth/session";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { listQueueTickets } from "@/app/lib/db/tickets";
import { listStaffProfiles } from "@/app/lib/db/profiles";
import { assignedToLabel } from "@/app/lib/people";
import { computeSla, slaBadgeLabel } from "@/app/lib/sla";
import { formatTicketNumber } from "@/app/lib/format";
import { isFrustrated, sortQueue } from "@/app/lib/queue";
import { widePageClass } from "@/app/lib/styles";
import { listMyFlaggedTicketIds } from "@/app/lib/db/flags";
import { listLabels, listLabelsForTickets } from "@/app/lib/db/labels";
import { Board, type BoardCard } from "./Board";

// The staff triage board: the same tickets as the queue (RLS-scoped, no
// closed ones), in columns by status, most urgent first within a column.
// Moving a card changes its status through moveTicketAction, limited to
// the transitions the database allows.
export default async function BoardPage() {
  const profile = await requireStaff();
  const now = new Date();
  const [queue, flagged, allLabels] = await Promise.all([
    listQueueTickets(profile.id, profile.role),
    listMyFlaggedTicketIds(),
    listLabels(),
  ]);
  const ticketLabels = await listLabelsForTickets(queue.map((t) => t.id));
  const tickets = sortQueue(queue, "sla", now);
  // Only admins see others' tickets, so only they need the staff list.
  const staff = new Map(
    (profile.role === "admin" ? await listStaffProfiles() : []).map((s) => [s.id, s])
  );

  const cards: BoardCard[] = tickets.map((t) => {
    const sla = computeSla(t, now);
    return {
      id: t.id,
      number: formatTicketNumber(t.number),
      subject: t.subject,
      status: t.status,
      assigneeId: t.assignee_id,
      mine: t.assignee_id === profile.id,
      flagged: flagged.has(t.id),
      assigneeLabel: t.assignee_id ? assignedToLabel(staff.get(t.assignee_id)) : null,
      priority: t.triage_state?.priority ?? null,
      category: t.triage_state?.category ?? null,
      teamLabels: ticketLabels.get(t.id) ?? [],
      sla: sla ? { label: slaBadgeLabel(sla), state: sla.state } : null,
      escalation: t.latest_triage?.is_escalation_risk ?? false,
      frustrated: isFrustrated(t.latest_triage?.frustration ?? null),
    };
  });

  return (
    <div className={widePageClass}>
      <div>
        <Breadcrumbs current="Board" />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">Board</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          Drag a ticket to another column, or use its Move menu. Only allowed moves are offered; moving an
          unassigned ticket to Assigned or In progress claims it for you.
        </p>
      </div>
      <Board cards={cards} allLabels={allLabels} />
    </div>
  );
}
