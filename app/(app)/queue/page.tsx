import Link from "next/link";

import { requireStaff } from "@/app/lib/auth/session";
import { listQueueTickets } from "@/app/lib/db/tickets";

export default async function QueuePage() {
  const profile = await requireStaff();
  const tickets = await listQueueTickets(profile.id, profile.role);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Queue
      </h1>

      {tickets.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Nothing in the queue.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link
                href={`/tickets/${ticket.id}`}
                className="flex items-center justify-between rounded-lg border border-black/[.08] px-4 py-3 hover:bg-black/[.03] dark:border-white/[.145] dark:hover:bg-white/[.05]"
              >
                <span className="font-medium text-black dark:text-zinc-50">
                  {ticket.subject}
                </span>
                <span className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-500">
                  {ticket.triage_state?.priority ? (
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        ticket.triage_state.priority === "urgent" ||
                        ticket.triage_state.priority === "high"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                          : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                      }`}
                    >
                      {ticket.triage_state.priority}
                    </span>
                  ) : null}
                  {ticket.assignee_id === null ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                      Unassigned
                    </span>
                  ) : null}
                  {ticket.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
