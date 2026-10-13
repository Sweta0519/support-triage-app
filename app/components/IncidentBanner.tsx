import Link from "next/link";

import { incidentLabel } from "@/app/lib/incidents";

export type BannerIncident = { id: string; number: number; title: string; first_seen_at: string; ticketCount: number };

// "Possible incident" on every staff page while one is open (SUP-42): a
// burst of similar tickets is something the whole team should know about
// at once. Server component; the layout passes the open incidents in.
export function IncidentBanner({ incidents }: { incidents: BannerIncident[] }) {
  if (incidents.length === 0) return null;
  const since = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div
      role="region"
      aria-label="Open incidents"
      className="flex flex-col gap-1 border-b border-red-200 bg-red-50 px-8 py-2.5 text-sm text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
    >
      {incidents.map((incident) => (
        <p key={incident.id} className="max-w-screen-2xl">
          <span className="font-semibold">Possible incident:</span> {incident.title} · {incident.ticketCount} tickets since{" "}
          {since(incident.first_seen_at)}.{" "}
          <Link href={`/incidents/${incident.id}`} className="font-medium underline underline-offset-2">
            View {incidentLabel(incident.number)}
          </Link>
        </p>
      ))}
    </div>
  );
}
