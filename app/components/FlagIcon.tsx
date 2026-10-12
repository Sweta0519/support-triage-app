// The viewer's own "follow up" flag (SUP-27/37), shown wherever a flagged
// ticket appears: queue cards, board cards, the ticket page. Flags are
// private, so this only ever reflects the viewer's own. Sky blue, not the
// amber the app uses for system warnings ("Unassigned", "AI unsure"): it's
// the user's marker, not an alert. Announced as "Flagged to follow up".
export function FlagIcon({ size = 14 }: { size?: number }) {
  return (
    <span
      role="img"
      aria-label="Flagged to follow up"
      title="Flagged to follow up"
      className="inline-flex shrink-0 text-sky-600 dark:text-sky-400"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
        <path d="M5 21V4h11l-1.5 4L16 12H7v9z" />
      </svg>
    </span>
  );
}
