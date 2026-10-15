import Link from "next/link";

import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { MY_TICKETS_CRUMB } from "@/app/lib/crumbs";

import { requireRole } from "@/app/lib/auth/session";
import { listMyTickets } from "@/app/lib/db/tickets";
import { Badge } from "@/app/components/Badge";
import { statusBadgeClasses, statusLabel } from "@/app/lib/badges";
import { formatTicketNumber } from "@/app/lib/format";
import { primaryButtonClass, readablePageClass } from "@/app/lib/styles";

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ requested?: string | string[] }> }) {
  const profile = await requireRole("customer");
  // Arriving from "Request access" (SUP-58): the request was just filed.
  const { requested } = await searchParams;
  const justRequested = (Array.isArray(requested) ? requested[0] : requested) === "1";
  const tickets = await listMyTickets(profile.id);

  return (
    <div className={readablePageClass}>
      <div className="flex items-center justify-between">
        <div>
          <Breadcrumbs current={MY_TICKETS_CRUMB.label} />
          <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">My tickets</h1>
        </div>
        <Link href="/tickets/new" className={primaryButtonClass}>
          New ticket
        </Link>
      </div>

      {justRequested ? (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <p className="font-medium">Thanks, we&apos;ve got your request.</p>
          <p className="mt-1">
            It&apos;s the access request below. Our team will reply on it, and you can add anything else there.
          </p>
        </div>
      ) : null}

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
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="shrink-0 font-mono text-xs text-zinc-500 dark:text-zinc-500">
                    {formatTicketNumber(ticket.number)}
                  </span>
                  <span className="truncate font-medium text-black dark:text-zinc-50">{ticket.subject}</span>
                </span>
                <Badge label={statusLabel(ticket.status)} colorClasses={statusBadgeClasses(ticket.status)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
