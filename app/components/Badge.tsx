export function Badge({
  label,
  colorClasses,
  capitalize = true,
}: {
  label: string;
  colorClasses: string;
  // Off for sentence-like labels ("Reply in 3h"); on for enum values such
  // as statuses and priorities, which are stored lowercase.
  capitalize?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        capitalize ? "capitalize" : ""
      } ${colorClasses}`}
    >
      {label}
    </span>
  );
}
