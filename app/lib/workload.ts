// Admin > Workload (SUP-77): the daily cap on new cases and the workplace
// timezone, shared by the page, its action and the messages a refused
// claim shows. No server-only import, so client components can use it. The
// database enforces the same rules (admin_set_workload(), the
// tickets_daily_case_cap trigger).

export const DAILY_CAP_MAX = 200;

// Shown when a claim (or a board move that claims) is refused.
export const DAILY_CAP_SELF_MESSAGE =
  "You've reached your daily limit of new cases. It resets at midnight in your timezone, and an admin can change it on Admin > Workload.";

// Shown to an admin whose Reassign or Assign is refused.
export function dailyCapAssigneeMessage(name: string): string {
  return `${name} has reached their daily limit of new cases. Raise it on Admin > Workload, or choose someone else.`;
}

// Every IANA zone this runtime knows, plus UTC (the column's default),
// which some runtimes leave out of the list.
export function timezoneNames(): string[] {
  const zones = Intl.supportedValuesOf("timeZone");
  return zones.includes("UTC") ? zones : ["UTC", ...zones];
}

export function isTimezone(value: unknown): value is string {
  return typeof value === "string" && timezoneNames().includes(value);
}

// "America/New_York" -> "New York (America)", for the picker.
export function timezoneLabel(zone: string): string {
  const parts = zone.split("/");
  if (parts.length === 1) return zone;
  const city = parts.slice(1).join(" / ").replaceAll("_", " ");
  return `${city} (${parts[0]})`;
}

// The local time there, e.g. "14:05", so the admin can check the choice.
export function localTime(zone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(now);
}
