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
