import Link from "next/link";

import { requireRole } from "@/app/lib/auth/session";
import { listMyTickets } from "@/app/lib/db/tickets";
import { Badge } from "@/app/components/Badge";
import { statusBadgeClasses, statusLabel } from "@/app/lib/badges";
import { primaryButtonClass } from "@/app/lib/styles";

export default async function TicketsPage() {
  const profile = await requireRole("customer");
  const tickets = await listMyTickets(profile.id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">My tickets</h1>
        <Link href="/tickets/new" className={primaryButtonClass}>
          New ticket
        </Link>
      </div>

      {tickets.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-black/[.15] py-16 text-center dark:border-white/[.2]">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">No tickets yet</p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600">
            File one and an AI triage agent will assess it right away.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link
                href={`/tickets/${ticket.id}`}
                className="flex items-center justify-between rounded-lg border border-black/[.08] px-4 py-3 transition-colors hover:border-indigo-200 hover:bg-indigo-50/40 dark:border-white/[.145] dark:hover:border-indigo-900 dark:hover:bg-indigo-950/20"
              >
                <span className="font-medium text-black dark:text-zinc-50">{ticket.subject}</span>
                <Badge label={statusLabel(ticket.status)} colorClasses={statusBadgeClasses(ticket.status)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
