import Link from "next/link";

import { requireStaff } from "@/app/lib/auth/session";
import { listStaffProfiles, type StaffProfile } from "@/app/lib/db/profiles";
import { listMyFlaggedTicketIds } from "@/app/lib/db/flags";
import { assignedToLabel, profileName } from "@/app/lib/people";
import { Avatar } from "@/app/components/Avatar";
import { listQueueTickets, type QueueTicketSummary } from "@/app/lib/db/tickets";
import { statusLabel } from "@/app/lib/badges";
import { formatRelativeTime, formatTicketNumber } from "@/app/lib/format";
import { ClaimButton } from "./ClaimButton";
import { CardMenuArea } from "./CardMenu";
import { QueueAnnouncer } from "./QueueAnnouncer";
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
import { effectiveTriageStatus } from "@/app/lib/triage-status";
import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { FlagIcon } from "@/app/components/FlagIcon";
import { CardLabels } from "@/app/components/CardLabels";
import { PriorityIcon, SlaText, StatusDot, UnassignedIcon } from "@/app/components/CardBits";
import { computeSla, slaBadgeLabel } from "@/app/lib/sla";
import { listLabels, listLabelsForTickets } from "@/app/lib/db/labels";
import type { TeamLabel } from "@/app/lib/labels";
import { widePageClass } from "@/app/lib/styles";

// The tab and sort a bare /queue opens on: the user's own defaults from
// account settings.
type QueueDefaults = { filter: QueueFilterKey; sort: QueueSort };

// Every link on the page keeps the rest of the view (tab, status, sort,
// search) and changes only what it's for. Defaults are left off the URL --
// the user's own, so "All" is spelled out for someone whose queue opens on
// "Mine".
function viewHref(filter: QueueFilterKey, view: QueueView, defaults: QueueDefaults): string {
  const params = new URLSearchParams();
  if (filter !== defaults.filter) params.set("filter", filter);
  if (view.status !== "all") params.set("status", view.status);
  if (view.sort !== defaults.sort) params.set("sort", view.sort);
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

// Whether anyone has checked the AI's latest run. Reviewed means *this*
// run was reviewed: after a re-run the newer run is unchecked again.
function reviewState(ticket: QueueTicketSummary): "unsure" | "unreviewed" | null {
  const ai = ticket.latest_triage;
  if (!ai || ticket.triage_state?.reviewed_result_id === ai.id) return null;
  return ai.needs_human_review ? "unsure" : "unreviewed";
}

// The card's summary line before an AI assessment exists. A run that died
// (stalled) or failed says so, rather than "Awaiting" forever.
function NoTriageYet({ state, now }: { state: QueueTicketSummary["triage_state"]; now: Date }) {
  const status = effectiveTriageStatus(state, { now: now.getTime(), aiConfigured: isAiConfigured() });
  if (status === "stalled" || status === "failed") {
    return (
      <span className="italic text-amber-700 dark:text-amber-400">
        AI triage {status} -- re-run it from the ⋯ menu or the ticket
      </span>
    );
  }
  // With AI off nothing will ever triage it: say so instead of "awaiting".
  if (!isAiConfigured()) {
    return <span className="italic text-amber-700 dark:text-amber-400">Needs manual triage -- AI triage is off</span>;
  }
  return <span className="italic text-zinc-500 dark:text-zinc-400">Awaiting AI triage</span>;
}

function TicketCard({
  ticket,
  filter,
  currentUserId,
  assignee,
  viewer,
  labels,
  allLabels,
  flagged,
  isAdmin,
  staffOptions,
  now,
  returnTo,
}: {
  ticket: QueueTicketSummary;
  filter: QueueFilterKey;
  currentUserId: string;
  flagged: boolean;
  isAdmin: boolean;
  staffOptions: { id: string; label: string }[];
  // Someone else's profile (only admins see others' tickets).
  assignee: StaffProfile | undefined;
  // The viewer, for their own avatar on tickets assigned to them.
  viewer: { name: string; avatarPath: string | null };
  // This ticket's team labels, and the whole list (for the ⋯ menu).
  labels: TeamLabel[] | undefined;
  allLabels: TeamLabel[];
  now: Date;
  // This queue view's URL, for a claim that loses the race to come back to.
  returnTo: string;
}) {
  const sla = computeSla(ticket, now);
  const teamLabels = labels ?? [];
  const priority = ticket.triage_state?.priority ?? null;
  const category = ticket.triage_state?.category ?? null;
  const unassigned = ticket.assignee_id === null;

  const triage = ticket.triage_state;
  return (
    <CardMenuArea
      ticket={{
        id: ticket.id,
        label: formatTicketNumber(ticket.number),
        href: ticketHref(ticket.id, filter),
        status: ticket.status,
        assigneeId: ticket.assignee_id,
        flagged,
        triage:
          triage?.priority && triage.category && triage.team
            ? { priority: triage.priority, category: triage.category, team: triage.team }
            : null,
        triageResultId: ticket.latest_triage?.id ?? null,
        labelIds: teamLabels.map((l) => l.id),
        triageReviewedAt: triage?.reviewed_at ?? null,
      }}
      currentUserId={currentUserId}
      allLabels={allLabels}
      isAdmin={isAdmin}
      staff={staffOptions}
      footer={
        unassigned ? (
          <ClaimButton
            ticketId={ticket.id}
            label={`Claim ${formatTicketNumber(ticket.number)}: ${ticket.subject}`}
            from={filter}
            returnTo={returnTo}
          />
        ) : null
      }
    >
      <div className="flex flex-1 flex-col transition-colors hover:bg-black/[.02] dark:hover:bg-white/[.03]">
      <Link
        // Carries the active tab along so the ticket page's breadcrumb
        // leads back here, not just to the full queue.
        href={ticketHref(ticket.id, filter)}
        className="flex flex-1 flex-col gap-1.5 px-4 pb-1.5 pt-4"
      >
        {/* Linear-style (SUP-38): priority icon, number and status up top,
            the flag and the assignee on the right; colour only in icons. */}
        <div className="flex items-center gap-2">
          <PriorityIcon priority={priority} />
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-500">
            {formatTicketNumber(ticket.number)}
          </span>
          <StatusDot status={ticket.status} />
          <span className="text-xs text-zinc-400 dark:text-zinc-500" title={new Date(ticket.created_at).toLocaleString("en-GB")}>
            {formatRelativeTime(ticket.created_at)}
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            {flagged ? <FlagIcon /> : null}
            {unassigned ? (
              <UnassignedIcon />
            ) : ticket.assignee_id === currentUserId ? (
              <span className="inline-flex" title="Assigned to you">
                <Avatar id={currentUserId} name={viewer.name} avatarPath={viewer.avatarPath} size={20} />
                <span className="sr-only">Assigned to you</span>
              </span>
            ) : ticket.assignee_id ? (
              <span className="inline-flex" title={assignedToLabel(assignee)}>
                <Avatar
                  id={ticket.assignee_id}
                  name={assignee ? profileName(assignee) : null}
                  avatarPath={assignee?.avatar_path ?? null}
                  size={20}
                />
                <span className="sr-only">{assignedToLabel(assignee)}</span>
              </span>
            ) : null}
          </span>
        </div>
        <span className="line-clamp-1 font-medium text-black dark:text-zinc-50">{ticket.subject}</span>
        <p className="line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
          {ticket.latest_triage?.summary ?? <NoTriageYet state={ticket.triage_state} now={now} />}
        </p>
      </Link>
        {/* Outside the link so the labels can be a button: click them (or
            hover the card and press L) to edit them in place (SUP-40). */}
        <div className="flex items-center justify-between gap-2 px-4 pb-3">
          <CardLabels
            ticketId={ticket.id}
            ticketLabel={formatTicketNumber(ticket.number)}
            allLabels={allLabels}
            appliedIds={teamLabels.map((l) => l.id)}
            signals={{
              category,
              escalation: ticket.latest_triage?.is_escalation_risk ?? false,
              frustrated: isFrustrated(ticket.latest_triage?.frustration ?? null),
              review: reviewState(ticket),
            }}
          />
          {sla ? <SlaText label={slaBadgeLabel(sla)} state={sla.state} /> : null}
        </div>
      </div>
    </CardMenuArea>
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
  // Only admins see tickets assigned to someone else (and assign them), so
  // only they need the staff list.
  const [tickets, flagged, staffList, allLabels] = await Promise.all([
    listQueueTickets(profile.id, profile.role),
    listMyFlaggedTicketIds(),
    profile.role === "admin" ? listStaffProfiles() : Promise.resolve([]),
    listLabels(),
  ]);
  const ticketLabels = await listLabelsForTickets(tickets.map((t) => t.id));
  const staff = new Map(staffList.map((s) => [s.id, s]));

  const staffOptions = [...staff.values()].map((s) => ({ id: s.id, label: profileName(s) }));
  const viewer = { name: profileName(profile), avatarPath: profile.avatar_path };

  const params = await searchParams;
  const defaults: QueueDefaults = { filter: profile.queue_default_filter, sort: profile.queue_default_sort };
  const filter = parseQueueFilter(params.filter, defaults.filter);
  const view = parseQueueView(params, defaults.sort);
  const returnTo = viewHref(filter, view, defaults);
  const claimTaken = params.notice === "claim-taken";
  const now = new Date();

  const tabCounts: Record<QueueFilterKey, number> = {
    all: tickets.length,
    unassigned: tickets.filter((t) => t.assignee_id === null).length,
    mine: tickets.filter((t) => t.assignee_id === profile.id).length,
    flagged: tickets.filter((t) => flagged.has(t.id)).length,
  };

  // Narrowing order: assignment tab -> search -> status. Tiles describe the
  // tab; status pill counts include the search so they match what a click
  // would show.
  const inTab = tickets.filter((t) => {
    if (filter === "unassigned") return t.assignee_id === null;
    if (filter === "mine") return t.assignee_id === profile.id;
    if (filter === "flagged") return flagged.has(t.id);
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
          {filter !== defaults.filter ? <input type="hidden" name="filter" value={filter} /> : null}
          {view.status !== "all" ? <input type="hidden" name="status" value={view.status} /> : null}
          {view.sort !== defaults.sort ? <input type="hidden" name="sort" value={view.sort} /> : null}
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
                href={viewHref(key, view, defaults)}
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
                  href={viewHref(filter, { ...view, status: s }, defaults)}
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
                href={viewHref(filter, { ...view, sort: s }, defaults)}
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

      {/* One live region for the card menus' confirmations; it wraps the
          empty state too, so the last card's message survives it leaving. */}
      <QueueAnnouncer>
      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-black/[.15] py-16 text-center dark:border-white/[.2]">
          <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
            {view.q !== ""
              ? `No tickets match "${view.q}"`
              : filter === "unassigned"
                ? "Nothing unassigned"
                : filter === "mine"
                  ? "Nothing assigned to you"
                  : filter === "flagged"
                    ? "Nothing flagged -- use a card's ⋯ menu to flag one"
                    : "Nothing in the queue"}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {view.q !== "" || view.status !== "all" ? (
              <Link href={viewHref(filter, { status: "all", sort: view.sort, q: "" }, defaults)} className="underline">
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
              assignee={ticket.assignee_id ? staff.get(ticket.assignee_id) : undefined}
              viewer={viewer}
              labels={ticketLabels.get(ticket.id)}
              allLabels={allLabels}
              flagged={flagged.has(ticket.id)}
              isAdmin={profile.role === "admin"}
              staffOptions={staffOptions}
              now={now}
              returnTo={returnTo}
            />
          ))}
        </ul>
      )}
      </QueueAnnouncer>
    </div>
  );
}
