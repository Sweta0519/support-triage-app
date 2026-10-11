import Link from "next/link";

import { requireStaff } from "@/app/lib/auth/session";
import { listQueueTickets, type QueueTicketSummary } from "@/app/lib/db/tickets";
import { Badge } from "@/app/components/Badge";
import { SlaBadge } from "@/app/components/SlaBadge";
import { priorityBadgeClasses, statusBadgeClasses, statusLabel } from "@/app/lib/badges";
import { formatRelativeTime, formatTicketNumber } from "@/app/lib/format";
import { computeSla } from "@/app/lib/sla";
import { fieldLabel } from "@/app/lib/triage-fields";
import { ClaimButton } from "./ClaimButton";
import { ClaimNotice } from "./ClaimNotice";
import {
  QUEUE_FILTERS,
  parseQueueFilter,
  ticketHref,
  type QueueFilterKey,
} from "@/app/lib/queue-filters";
import {
  isFrustrated,
  matchesSearch,
  parseQueueView,
  QUEUE_SORTS,
  QUEUE_STATUSES,
  sortQueue,
  type QueueSort,
  type QueueView,
} from "@/app/lib/queue";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { widePageClass, chipClass } from "@/app/lib/styles";

const chipClasses = chipClass;

// Every link on the page keeps the rest of the view (tab, status, sort,
// search) and changes only what it's for. Defaults are left off the URL.
function viewHref(filter: QueueFilterKey, view: QueueView): string {
  const params = new URLSearchParams();
  if (filter !== "all") params.set("filter", filter);
  if (view.status !== "all") params.set("status", view.status);
  if (view.sort !== "sla") params.set("sort", view.sort);
  if (view.q !== "") params.set("q", view.q);
  const query = params.toString();
  return query ? `/queue?${query}` : "/queue";
}

function StatTile({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone ?? "text-black dark:text-zinc-50"}`}>{value}</p>
      <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">{detail}</p>
    </div>
  );
}

// The AI's read of the ticket, in the order an agent cares about it.
function AiChips({ ticket }: { ticket: QueueTicketSummary }) {
  const ai = ticket.latest_triage;
  if (!ai) return null;
  // Reviewed means this run was reviewed: after a re-run the newer run's
  // flags are on the card and nobody has checked them yet.
  const reviewed = ticket.triage_state?.reviewed_result_id === ai.id;
  return (
    <>
      {ai.is_escalation_risk ? (
        <span className={`${chipClasses} bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300`}>
          Escalation risk
        </span>
      ) : null}
      {isFrustrated(ai.frustration) ? (
        <span className={`${chipClasses} bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300`}>
          Frustrated
        </span>
      ) : null}
      {reviewed ? null : ai.needs_human_review ? (
        <span
          title="The AI flagged its own triage for a human to check"
          className={`${chipClasses} bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300`}
        >
          AI unsure
        </span>
      ) : (
        <span
          title="Nobody has confirmed or corrected the AI's triage yet"
          className={`${chipClasses} bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400`}
        >
          AI unreviewed
        </span>
      )}
    </>
  );
}

function TicketCard({
  ticket,
  filter,
  currentUserId,
  now,
  returnTo,
}: {
  ticket: QueueTicketSummary;
  filter: QueueFilterKey;
  currentUserId: string;
  now: Date;
  // This queue view's URL, for a claim that loses the race to come back to.
  returnTo: string;
}) {
  const sla = computeSla(ticket, now);
  const priority = ticket.triage_state?.priority ?? null;
  const category = ticket.triage_state?.category ?? null;
  const unassigned = ticket.assignee_id === null;

  return (
    <li className="flex flex-col overflow-hidden rounded-xl border border-black/[.08] transition-colors hover:border-indigo-300 dark:border-white/[.145] dark:hover:border-indigo-800">
      <Link
        // Carries the active tab along so the ticket page's breadcrumb
        // leads back here, not just to the full queue.
        href={ticketHref(ticket.id, filter)}
        className="flex flex-1 flex-col gap-2 p-4 transition-colors hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20"
      >
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
            {formatTicketNumber(ticket.number)}
          </span>
          <Badge label={statusLabel(ticket.status)} colorClasses={statusBadgeClasses(ticket.status)} />
          {sla ? (
            <span className="ml-auto">
              <SlaBadge sla={sla} />
            </span>
          ) : null}
        </div>
        <span className="line-clamp-1 font-medium text-black dark:text-zinc-50">{ticket.subject}</span>
        <p className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
          {ticket.latest_triage?.summary ?? (
            <span className="italic text-zinc-500 dark:text-zinc-400">Awaiting AI triage</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {priority ? <Badge label={priority} colorClasses={priorityBadgeClasses(priority)} /> : null}
          {category ? (
            <span className={`${chipClasses} border border-black/[.08] capitalize text-zinc-600 dark:border-white/[.145] dark:text-zinc-400`}>
              {fieldLabel(category)}
            </span>
          ) : null}
          <AiChips ticket={ticket} />
        </div>
        <div className="mt-auto flex items-center justify-between pt-1 text-xs text-zinc-500 dark:text-zinc-500">
          <span>{formatRelativeTime(ticket.created_at)}</span>
          {unassigned ? (
            <Badge
              label="Unassigned"
              colorClasses="bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            />
          ) : ticket.assignee_id === currentUserId ? (
            <span>Assigned to you</span>
          ) : null}
        </div>
      </Link>
      {unassigned ? (
        <ClaimButton
          ticketId={ticket.id}
          label={`Claim ${formatTicketNumber(ticket.number)}: ${ticket.subject}`}
          from={filter}
          returnTo={returnTo}
        />
      ) : null}
    </li>
  );
}

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string | string[];
    status?: string | string[];
    sort?: string | string[];
    q?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const profile = await requireStaff();
  const tickets = await listQueueTickets(profile.id, profile.role);

  const params = await searchParams;
  const filter = parseQueueFilter(params.filter);
  const view = parseQueueView(params);
  const returnTo = viewHref(filter, view);
  const claimTaken = params.notice === "claim-taken";
  const now = new Date();

  const tabCounts: Record<QueueFilterKey, number> = {
    all: tickets.length,
    unassigned: tickets.filter((t) => t.assignee_id === null).length,
    mine: tickets.filter((t) => t.assignee_id === profile.id).length,
  };

  // Narrowing order: assignment tab -> search -> status. Tiles describe the
  // tab; status pill counts include the search so they match what a click
  // would show.
  const inTab = tickets.filter((t) => {
    if (filter === "unassigned") return t.assignee_id === null;
    if (filter === "mine") return t.assignee_id === profile.id;
    return true;
  });
  const searched = inTab.filter((t) => matchesSearch(t, view.q));
  const visible = sortQueue(
    view.status === "all" ? searched : searched.filter((t) => t.status === view.status),
    view.sort,
    now
  );

  const slaStates = inTab.map((t) => computeSla(t, now)?.state);
  const open = inTab.filter((t) => t.status !== "resolved").length;
  const atRisk = slaStates.filter((s) => s === "at_risk").length;
  const breached = slaStates.filter((s) => s === "breached").length;
  const resolved = inTab.length - open;

  const statusCounts = Object.fromEntries(
    QUEUE_STATUSES.map((s) => [s, searched.filter((t) => t.status === s).length])
  );

  return (
    // Wide screens get more card columns (see the grid below) rather than
    // more empty margin.
    <div className={widePageClass}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Breadcrumbs current="Queue" />
          <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">Queue</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
            Tickets assigned to you or waiting to be claimed.
          </p>
        </div>
        {/* A plain GET form: works without JavaScript and keeps the view in the URL. */}
        <form action="/queue" className="flex w-full items-center gap-2 sm:w-auto">
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          {view.status !== "all" ? <input type="hidden" name="status" value={view.status} /> : null}
          {view.sort !== "sla" ? <input type="hidden" name="sort" value={view.sort} /> : null}
          <input
            type="search"
            name="q"
            defaultValue={view.q}
            placeholder="Search tickets"
            title="Search by number (#1042), subject, AI summary, category or team"
            aria-describedby="queue-search-hint"
            aria-label="Search tickets"
            className="w-full rounded-lg border border-black/[.08] bg-white px-3 py-1.5 text-sm text-black placeholder:text-zinc-400 sm:w-72 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
          />
          <span id="queue-search-hint" className="sr-only">
            Search by ticket number (for example #1042), subject, AI summary, category or team.
          </span>
        </form>
      </div>

      {claimTaken ? <ClaimNotice /> : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Open"
          value={open}
          detail={`${inTab.filter((t) => t.status !== "resolved" && t.assignee_id === null).length} unassigned`}
        />
        <StatTile
          label="SLA at risk"
          value={atRisk}
          detail="First reply due soon"
          tone={atRisk > 0 ? "text-amber-700 dark:text-amber-400" : undefined}
        />
        <StatTile
          label="SLA breached"
          value={breached}
          detail="Waiting past the target"
          tone={breached > 0 ? "text-red-700 dark:text-red-400" : undefined}
        />
        <StatTile label="Resolved" value={resolved} detail="Not yet closed" />
      </section>

      <div className="flex flex-col gap-3">
        <nav aria-label="Assignment" className="flex gap-1 border-b border-black/[.08] dark:border-white/[.145]">
          {QUEUE_FILTERS.map(({ key, label }) => {
            const active = key === filter;
            return (
              <Link
                key={key}
                href={viewHref(key, view)}
                aria-current={active ? "page" : undefined}
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
                  {tabCounts[key]}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
            {(["all", ...QUEUE_STATUSES] as const).map((s) => {
              const active = view.status === s;
              const count = s === "all" ? searched.length : statusCounts[s];
              return (
                <Link
                  key={s}
                  href={viewHref(filter, { ...view, status: s })}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    active
                      ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                      : "text-zinc-600 hover:bg-black/[.05] dark:text-zinc-400 dark:hover:bg-white/[.06]"
                  }`}
                >
                  {s === "all" ? "All" : statusLabel(s)}
                  <span className="tabular-nums opacity-70">{count}</span>
                </Link>
              );
            })}
          </nav>
          <nav aria-label="Sort" className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-500">
            <span className="mr-1">Sort:</span>
            {(Object.keys(QUEUE_SORTS) as QueueSort[]).map((s) => (
              <Link
                key={s}
                href={viewHref(filter, { ...view, sort: s })}
                aria-current={view.sort === s ? "page" : undefined}
                className={`rounded-md px-2 py-1 transition-colors ${
                  view.sort === s
                    ? "bg-black/[.06] font-medium text-black dark:bg-white/[.1] dark:text-zinc-50"
                    : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                }`}
              >
                {QUEUE_SORTS[s]}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-black/[.15] py-16 text-center dark:border-white/[.2]">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {view.q !== ""
              ? `No tickets match "${view.q}"`
              : filter === "unassigned"
                ? "Nothing unassigned"
                : filter === "mine"
                  ? "Nothing assigned to you"
                  : "Nothing in the queue"}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {view.q !== "" || view.status !== "all" ? (
              <Link href={viewHref(filter, { status: "all", sort: view.sort, q: "" })} className="underline">
                Clear search and status filter
              </Link>
            ) : (
              "You're all caught up."
            )}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visible.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              filter={filter}
              currentUserId={profile.id}
              now={now}
              returnTo={returnTo}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
