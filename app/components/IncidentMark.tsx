import { incidentLabel } from "@/app/lib/incidents";

// A ticket that's part of an open incident (SUP-42), on queue and board
// cards: a small red pulse line, named for screen readers and in the
// tooltip. Not a link -- the card itself is one; the ticket page links to
// the incident.
export function IncidentMark({ incident, size = 14 }: { incident: { number: number; title: string }; size?: number }) {
  const label = `Part of incident ${incidentLabel(incident.number)}: ${incident.title}`;
  return (
    <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 text-red-600 dark:text-red-400">
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 12h4l2-5 4 10 2-5h6" />
      </svg>
    </span>
  );
}
