import Link from "next/link";

import { requireRole } from "@/app/lib/auth/session";
import { listMyTickets } from "@/app/lib/db/tickets";

export default async function TicketsPage() {
  const profile = await requireRole("customer");
  const tickets = await listMyTickets(profile.id);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          My tickets
        </h1>
        <Link
          href="/tickets/new"
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          New ticket
        </Link>
      </div>

      {tickets.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          No tickets yet.
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
                <span className="text-xs text-zinc-500 dark:text-zinc-500">
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
