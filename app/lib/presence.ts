// Staff presence (SUP-76): the three states an agent or admin picks from
// the dropdown under their name. No server-only import, so the sidebar can
// use the labels. The database enforces the same set with a check
// constraint on ticketing.profiles.presence.

export const PRESENCES = {
  online: "Online",
  away: "Away",
  offline: "Offline",
} as const;
export type Presence = keyof typeof PRESENCES;

export function isPresence(value: unknown): value is Presence {
  return typeof value === "string" && Object.hasOwn(PRESENCES, value);
}

// Colour only in the dot, per the calm UI: the label itself stays neutral.
export const PRESENCE_DOT: Record<Presence, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-400",
  offline: "bg-zinc-400 dark:bg-zinc-500",
};
