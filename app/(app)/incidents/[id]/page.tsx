import Link from "next/link";
import { notFound } from "next/navigation";

import { requireStaff } from "@/app/lib/auth/session";
import { countIncidentTickets, getIncident, listIncidentTickets } from "@/app/lib/db/incidents";
import { isUuid } from "@/app/lib/db/tickets";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { StatusDot } from "@/app/components/CardBits";
import { formatRelativeTime, formatTicketNumber } from "@/app/lib/format";
import { INCIDENT_STATUS_LABEL, incidentLabel } from "@/app/lib/incidents";
import { linkClass, readablePageClass } from "@/app/lib/styles";
import { IncidentActions } from "./IncidentActions";

// One incident (SUP-42): what the grouped tickets have in common (written
// by the AI from their summaries), the tickets the viewer can see, and the
// actions -- post one update to all of them, resolve, or dismiss.
export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const incident = await getIncident(id);
  if (!incident) notFound();
  const [tickets, totals] = await Promise.all([listIncidentTickets(id), countIncidentTickets([id])]);
  const total = totals.get(id) ?? tickets.length;
  const openTickets = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  const time = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className={readablePageClass}>
      <Breadcrumbs parents={[{ href: "/incidents", label: "Incidents" }]} current={incidentLabel(incident.number)} />
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-mono">{incidentLabel(incident.number)}</span>
          <span>·</span>
          <span>{INCIDENT_STATUS_LABEL[incident.status]}</span>
          <span>·</span>
          <span title={time(incident.first_seen_at)}>First report {formatRelativeTime(incident.first_seen_at)}</span>
          <span>·</span>
          <span title={time(incident.opened_at)}>Detected {formatRelativeTime(incident.opened_at)}</span>
        </div>
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">{incident.title}</h1>
        {incident.summary ? <p className="text-sm text-zinc-700 dark:text-zinc-300">{incident.summary}</p> : null}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          ✦ Grouped automatically because the tickets read alike and arrived close together. Written by AI from the tickets&apos;
          summaries -- check it. If these aren&apos;t one problem, dismiss it.
        </p>
      </div>

      <section aria-labelledby="incident-tickets" className="flex flex-col gap-2">
        <h2 id="incident-tickets" className="text-sm font-semibold text-black dark:text-zinc-50">
          Tickets ({total})
        </h2>
        {total > tickets.length ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {total - tickets.length} more {total - tickets.length === 1 ? "is" : "are"} assigned to someone else, so not shown or
            updated from here.
          </p>
        ) : null}
        <ul className="flex flex-col divide-y divide-black/[.06] rounded-xl border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.145]">
          {tickets.map((t) => (
            <li key={t.id} className="flex items-center gap-3 p-3 text-sm">
              <span className="font-mono text-xs text-zinc-500">{formatTicketNumber(t.number)}</span>
              <Link href={`/tickets/${t.id}`} className={`min-w-0 flex-1 truncate ${linkClass}`}>
                {t.subject}
              </Link>
              <StatusDot status={t.status} />
              <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{formatRelativeTime(t.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Mounted for a closed incident too, so the confirmation of the
          resolve/dismiss that closed it survives the refresh (SUP-45). */}
      <IncidentActions
        incidentId={incident.id}
        status={incident.status}
        closedAt={incident.closed_at}
        draft={incident.draft_update ?? ""}
        openTicketCount={openTickets.length}
        updatePostedAt={incident.update_posted_at}
      />
    </div>
  );
}
