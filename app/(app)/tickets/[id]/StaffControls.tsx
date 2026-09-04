import { assignTicketAction, claimTicketAction, updateStatusAction } from "../actions";
import type { TicketStatus } from "@/app/lib/db/tickets";
import type { StaffProfile } from "@/app/lib/db/profiles";

const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  triaged: "Triaged",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export function StaffControls({
  ticketId,
  status,
  assigneeId,
  currentUserId,
  allowedNext,
  isAdmin,
  staff,
}: {
  ticketId: string;
  status: TicketStatus;
  assigneeId: string | null;
  currentUserId: string;
  allowedNext: TicketStatus[];
  isAdmin: boolean;
  // Only populated for admins; agents never see other staff listed here.
  staff: StaffProfile[];
}) {
  const assigneeEmail = staff.find((s) => s.id === assigneeId)?.email;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        {assigneeId === null
          ? "Unassigned"
          : assigneeId === currentUserId
            ? "Assigned to you"
            : assigneeEmail
              ? `Assigned to ${assigneeEmail}`
              : "Assigned"}
      </p>

      {assigneeId === null && status !== "resolved" && status !== "closed" ? (
        <form action={claimTicketAction}>
          <input type="hidden" name="ticketId" value={ticketId} />
          <button
            type="submit"
            className="rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Claim ticket
          </button>
        </form>
      ) : allowedNext.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {allowedNext.map((next) => (
            <form key={next} action={updateStatusAction}>
              <input type="hidden" name="ticketId" value={ticketId} />
              <input type="hidden" name="status" value={next} />
              <button
                type="submit"
                className="rounded-full border border-black/[.08] px-4 py-1.5 text-xs font-medium transition-colors hover:bg-black/[.05] dark:border-white/[.145] dark:hover:bg-white/[.06]"
              >
                Move to {STATUS_LABELS[next]}
              </button>
            </form>
          ))}
        </div>
      ) : (
        <p className="text-xs text-zinc-400 dark:text-zinc-600">
          {STATUS_LABELS[status]} is a final state.
        </p>
      )}

      {isAdmin ? (
        <form
          action={assignTicketAction}
          className="flex flex-wrap items-center gap-2 border-t border-black/[.08] pt-3 dark:border-white/[.145]"
        >
          <input type="hidden" name="ticketId" value={ticketId} />
          <label className="text-xs text-zinc-500 dark:text-zinc-500" htmlFor={`assignee-${ticketId}`}>
            Reassign
          </label>
          <select
            id={`assignee-${ticketId}`}
            name="assigneeId"
            defaultValue={assigneeId ?? ""}
            className="rounded-lg border border-black/[.08] bg-white px-2 py-1 text-xs text-black dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          >
            <option value="">Unassigned</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.email} ({s.role})
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-full border border-black/[.08] px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.05] dark:border-white/[.145] dark:hover:bg-white/[.06]"
          >
            Assign
          </button>
        </form>
      ) : null}
    </div>
  );
}
