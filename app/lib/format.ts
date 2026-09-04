// Triage costs are sub-cent (embedding + a short completion), so a plain
// toFixed(2) rounds most runs to "$0.00" -- not useful for judging whether
// AI usage is cheap. Show enough precision to see the number move; a rarer
// larger total (e.g. the admin's running sum) doesn't need as much.
export function formatCostUsd(cost: number, precision: "fine" | "coarse" = "fine"): string {
  if (cost <= 0) {
    return "$0.00";
  }
  if (cost >= 0.01) {
    return `$${cost.toFixed(precision === "fine" ? 4 : 2)}`;
  }
  return `$${cost.toFixed(5)}`;
}

const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

// Queue rows show ticket age ("3h ago") instead of a full timestamp -- much
// faster to scan for what's been waiting longest.
export function formatRelativeTime(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  for (const { unit, ms } of RELATIVE_TIME_UNITS) {
    if (Math.abs(diffMs) >= ms) {
      return relativeTimeFormatter.format(Math.round(diffMs / ms), unit);
    }
  }
  return relativeTimeFormatter.format(Math.round(diffMs / 1000), "second");
}
