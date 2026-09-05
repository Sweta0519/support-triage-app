export function Badge({
  label,
  colorClasses,
}: {
  label: string;
  colorClasses: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${colorClasses}`}
    >
      {label}
    </span>
  );
}
