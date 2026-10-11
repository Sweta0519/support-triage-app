// A 1-5 star score, shown the same way everywhere (rating panel, the
// ticket's staff view, analytics). Screen readers get "4 of 5 stars".
export function Stars({ score, className = "" }: { score: number; className?: string }) {
  return (
    <span role="img" aria-label={`${score} of 5 stars`} className={`tracking-wide ${className}`}>
      <span aria-hidden className="text-amber-500">
        {"★".repeat(score)}
      </span>
      <span aria-hidden className="text-zinc-300 dark:text-zinc-700">
        {"★".repeat(5 - score)}
      </span>
    </span>
  );
}
