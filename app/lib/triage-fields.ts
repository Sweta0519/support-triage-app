// The closed sets behind ticketing.ticket_priority / ticket_category /
// ticket_team. Shared by the review form (client) and the Server Action that
// validates it, so it must not import anything server-only. Keep in sync
// with the enums in supabase/migrations/20260903010000_tickets.sql.

export const TRIAGE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TRIAGE_CATEGORIES = [
  "general",
  "billing",
  "technical",
  "bug",
  "feature_request",
  "account",
] as const;
export const TRIAGE_TEAMS = ["support", "billing", "engineering"] as const;

export type TriagePriority = (typeof TRIAGE_PRIORITIES)[number];
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];
export type TriageTeam = (typeof TRIAGE_TEAMS)[number];

export type TriageReviewFields = {
  priority: TriagePriority;
  category: TriageCategory;
  team: TriageTeam;
};

export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

export function fieldLabel(value: string): string {
  return value.replace(/_/g, " ");
}
