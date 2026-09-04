import Link from "next/link";

import { requireStaff } from "@/app/lib/auth/session";
import { listQueueTickets } from "@/app/lib/db/tickets";
import { Badge } from "@/app/components/Badge";
import { priorityBadgeClasses, statusBadgeClasses, statusLabel } from "@/app/lib/badges";

export default async function QueuePage() {
  const profile = await requireStaff();
  const tickets = await listQueueTickets(profile.id, profile.role);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Queue</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          Tickets assigned to you or waiting to be claimed.
        </p>
      </div>

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-black/[.15] py-16 text-center dark:border-white/[.2]">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            Nothing in the queue
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600">You&apos;re all caught up.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link
                href={`/tickets/${ticket.id}`}
                className="flex items-center justify-between gap-4 rounded-lg border border-black/[.08] px-4 py-3 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-white/[.145] dark:hover:border-indigo-900 dark:hover:bg-indigo-950/20"
              >
                <span className="truncate font-medium text-black dark:text-zinc-50">
                  {ticket.subject}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {ticket.triage_state?.priority ? (
                    <Badge
                      label={ticket.triage_state.priority}
                      colorClasses={priorityBadgeClasses(ticket.triage_state.priority)}
                    />
                  ) : null}
                  {ticket.assignee_id === null ? (
                    <Badge
                      label="Unassigned"
                      colorClasses="bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                    />
                  ) : null}
                  <Badge label={statusLabel(ticket.status)} colorClasses={statusBadgeClasses(ticket.status)} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
