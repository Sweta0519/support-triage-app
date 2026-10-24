// Working hours (SUP-85): the days and times of someone's shift, in their
// workplace timezone, set by an admin on Admin > Workload. During the shift
// their status shows Online, outside it Offline, unless they picked a status
// themselves since the shift last started or ended. Nothing runs on a timer:
// shownPresence() works the status out whenever it's read. No server-only
// import, so client components can use the labels. The database enforces
// the same rules (admin_set_workload(), profiles_work_hours_check).

import type { Presence } from "@/app/lib/presence";

// ISO weekdays: 1 = Monday .. 7 = Sunday, as the database stores them.
export const WEEKDAYS = [
  { day: 1, short: "Mon", letter: "M" },
  { day: 2, short: "Tue", letter: "T" },
  { day: 3, short: "Wed", letter: "W" },
  { day: 4, short: "Thu", letter: "T" },
  { day: 5, short: "Fri", letter: "F" },
  { day: 6, short: "Sat", letter: "S" },
  { day: 7, short: "Sun", letter: "S" },
] as const;

export type WorkHours = {
  work_days: number[] | null;
  // "HH:MM" or "HH:MM:SS", as Postgres returns a time.
  work_start: string | null;
  work_end: string | null;
};

export type PresenceSource = {
  presence: Presence;
  presence_set_at: string | null;
  timezone: string;
} & WorkHours;

export function isWeekday(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

// "09:30" or "09:30:00" -> minutes since midnight; null if malformed.
export function timeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// The wall-clock time in a zone, as if that zone were UTC: comparing two of
// these compares local times there. Seconds are kept so a pick made a few
// seconds after a shift edge still counts as after it.
function wallClock(at: Date, zone: string): { ms: number; isoDay: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const ms = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const isoDay = ((new Date(ms).getUTCDay() + 6) % 7) + 1;
  return { ms, isoDay };
}

// Whether the shift is on now, and when (in wall-clock ms) it last started
// or ended. Looks back eight days: far enough to reach the latest edge of
// any schedule, including a night shift begun the day before.
function shiftNow(hours: WorkHours, zone: string, now: Date): { onShift: boolean; lastEdge: number } | null {
  if (!hours.work_days?.length || !hours.work_start || !hours.work_end) return null;
  const start = timeToMinutes(hours.work_start);
  const end = timeToMinutes(hours.work_end);
  if (start === null || end === null || start === end) return null;

  const { ms: nowMs, isoDay: today } = wallClock(now, zone);
  const midnight = nowMs - (nowMs % DAY);
  let onShift = false;
  let lastEdge = -Infinity;
  for (let back = 0; back <= 7; back++) {
    const isoDay = ((today - 1 - back + 7 * 2) % 7) + 1;
    if (!hours.work_days.includes(isoDay)) continue;
    const dayStart = midnight - back * DAY;
    const startsAt = dayStart + start * MINUTE;
    const endsAt = dayStart + end * MINUTE + (end < start ? DAY : 0);
    if (startsAt <= nowMs && nowMs < endsAt) onShift = true;
    for (const edge of [startsAt, endsAt]) if (edge <= nowMs && edge > lastEdge) lastEdge = edge;
  }
  return { onShift, lastEdge };
}

// The status to show, and whether the schedule or the person's own pick
// decided it. A pick made since the shift last started or ended holds; an
// older one gives way to the schedule. No schedule: the pick always holds.
export function shownPresence(
  profile: PresenceSource,
  now: Date = new Date(),
): { presence: Presence; source: "schedule" | "manual" } {
  const shift = shiftNow(profile, profile.timezone, now);
  if (!shift) return { presence: profile.presence, source: "manual" };
  if (profile.presence_set_at) {
    const pickedAt = wallClock(new Date(profile.presence_set_at), profile.timezone).ms;
    if (pickedAt >= shift.lastEdge) return { presence: profile.presence, source: "manual" };
  }
  return { presence: shift.onShift ? "online" : "offline", source: "schedule" };
}
