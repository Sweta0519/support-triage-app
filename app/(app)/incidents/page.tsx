import Link from "next/link";

import { requireStaff } from "@/app/lib/auth/session";
import { countIncidentTickets, listIncidents } from "@/app/lib/db/incidents";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { formatRelativeTime } from "@/app/lib/format";
import { INCIDENT_MIN_TICKETS, INCIDENT_STATUS_LABEL, INCIDENT_WINDOW_MINUTES, incidentLabel } from "@/app/lib/incidents";
import { readablePageClass } from "@/app/lib/styles";

const STATUS_DOT = { open: "bg-red-500", resolved: "bg-emerald-500", dismissed: "bg-zinc-300 dark:bg-zinc-600" } as const;

// Incidents (SUP-42): bursts of similar tickets the app grouped by itself.
// Staff only.
export default async function IncidentsPage() {
  await requireStaff();
  const incidents = await listIncidents();
  const counts = await countIncidentTickets(incidents.map((i) => i.id));

  return (
    <div className={readablePageClass}>
      <Breadcrumbs current="Incidents" />
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Incidents</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          When {INCIDENT_MIN_TICKETS} or more customers report what looks like the same problem within {INCIDENT_WINDOW_MINUTES}{" "}
          minutes, their tickets are grouped here. Staff only -- customers never see incidents.
        </p>
      </div>
      {incidents.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No incidents so far.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-black/[.06] rounded-xl border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.145]">
          {incidents.map((incident) => (
            <li key={incident.id}>
              <Link
                href={`/incidents/${incident.id}`}
                className="flex items-center gap-3 p-4 hover:bg-black/[.02] dark:hover:bg-white/[.03]"
              >
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[incident.status]}`} />
                <span className="font-mono text-xs text-zinc-500">{incidentLabel(incident.number)}</span>
                <span className="min-w-0 flex-1 truncate font-medium text-black dark:text-zinc-50">{incident.title}</span>
                <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
                  {INCIDENT_STATUS_LABEL[incident.status]} · {counts.get(incident.id) ?? 0} tickets ·{" "}
                  {formatRelativeTime(incident.opened_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
