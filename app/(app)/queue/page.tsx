import Link from "next/link";

import { requireStaff } from "@/app/lib/auth/session";
import { listQueueTickets } from "@/app/lib/db/tickets";
import { Badge } from "@/app/components/Badge";
import {
  priorityBadgeClasses,
  priorityBarClasses,
  statusBadgeClasses,
  statusLabel,
} from "@/app/lib/badges";
import { formatRelativeTime } from "@/app/lib/format";
import { primaryButtonClass } from "@/app/lib/styles";
import { claimTicketAction } from "../tickets/actions";
import {
  QUEUE_FILTERS,
  parseQueueFilter,
  queueBreadcrumb,
  queueHref,
  ticketHref,
  type QueueFilterKey,
} from "@/app/lib/queue-filters";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>;
}) {
  const profile = await requireStaff();
  const tickets = await listQueueTickets(profile.id, profile.role);

  const { filter: rawFilter } = await searchParams;
  const filter = parseQueueFilter(rawFilter);

  const counts: Record<QueueFilterKey, number> = {
    all: tickets.length,
    unassigned: tickets.filter((t) => t.assignee_id === null).length,
    mine: tickets.filter((t) => t.assignee_id === profile.id).length,
  };

  const visible = tickets.filter((ticket) => {
    if (filter === "unassigned") return ticket.assignee_id === null;
    if (filter === "mine") return ticket.assignee_id === profile.id;
    return true;
  });

  // "Home / Queue" on the All tab; "Home / Queue / Mine" when a tab is
  // active, so the tab is named and the full queue is one click away.
  const trail = queueBreadcrumb(filter);
  const current = trail[trail.length - 1].label;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <Breadcrumbs parents={trail.slice(0, -1)} current={current} />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">Queue</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          Tickets assigned to you or waiting to be claimed.
        </p>
      </div>

      <div className="flex gap-1 border-b border-black/[.08] dark:border-white/[.145]">
        {QUEUE_FILTERS.map(({ key, label }) => {
          const active = key === filter;
          return (
            <Link
              key={key}
              href={queueHref(key)}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                  : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-300"
              }`}
            >
              {label}
              <span
                className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${
                  active
                    ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
                }`}
              >
                {counts[key]}
              </span>
            </Link>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-black/[.15] py-16 text-center dark:border-white/[.2]">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {filter === "unassigned"
              ? "Nothing unassigned"
              : filter === "mine"
                ? "Nothing assigned to you"
                : "Nothing in the queue"}
          </p>
          <p className="text-xs text-zinc-400 dark:text-zinc-600">You&apos;re all caught up.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((ticket) => {
            const unassigned = ticket.assignee_id === null;
            const meta = [ticket.triage_state?.category, ticket.triage_state?.team]
              .filter(Boolean)
              .join(" · ");

            return (
              <li
                key={ticket.id}
                className="flex items-stretch overflow-hidden rounded-lg border border-black/[.08] transition-colors hover:border-indigo-200 dark:border-white/[.145] dark:hover:border-indigo-900"
              >
                <span
                  className={`w-1 shrink-0 ${priorityBarClasses(ticket.triage_state?.priority ?? null)}`}
                />
                <Link
                  // Carries the active tab along so the ticket page's
                  // breadcrumb leads back here, not just to the full queue.
                  href={ticketHref(ticket.id, filter)}
                  className="flex flex-1 flex-col gap-2 px-4 py-3 transition-colors hover:bg-indigo-50/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:hover:bg-indigo-950/20"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-medium text-black dark:text-zinc-50">
                      {ticket.subject}
                    </span>
                    <span className="truncate text-xs text-zinc-500 dark:text-zinc-500">
                      {meta || "Awaiting triage"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    {ticket.triage_state?.priority ? (
                      <Badge
                        label={ticket.triage_state.priority}
                        colorClasses={priorityBadgeClasses(ticket.triage_state.priority)}
                      />
                    ) : null}
                    {unassigned ? (
                      <Badge
                        label="Unassigned"
                        colorClasses="bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                      />
                    ) : null}
                    <Badge
                      label={statusLabel(ticket.status)}
                      colorClasses={statusBadgeClasses(ticket.status)}
                    />
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-zinc-400 dark:text-zinc-600">
                      {formatRelativeTime(ticket.created_at)}
                    </span>
                  </div>
                </Link>
                {unassigned ? (
                  <form
                    action={claimTicketAction}
                    className="flex items-center border-l border-black/[.08] px-3 dark:border-white/[.145]"
                  >
                    <input type="hidden" name="ticketId" value={ticket.id} />
                    <button type="submit" className={`whitespace-nowrap ${primaryButtonClass} !px-3 !py-1 !text-xs`}>
                      Claim
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
