// Working hours (SUP-85): the days and times of someone's shift, in their
// workplace timezone, set by an admin on Admin > Workload. During the shift
// their status shows Online, outside it Offline, unless they picked a status
// themselves since the shift last started or ended. Nothing runs on a timer:
// shownPresence() works the status out whenever it's read. Equal start and
// end times mean a 24-hour shift. No server-only
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

// The hours as the Workload form sends them: "HH:MM" times.
export type WorkSchedule = { days: number[]; start: string; end: string };

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

// One formatter per zone: building one is slow, and every staff page and
// every Workload row needs them.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(zone, f);
  }
  return f;
}

// The wall-clock time in a zone, as if that zone were UTC, to the second.
function wallClock(at: number, zone: string): { ms: number; isoDay: number } {
  const parts = formatter(zone).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const ms = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const isoDay = ((new Date(ms).getUTCDay() + 6) % 7) + 1;
  return { ms, isoDay };
}

// The instant a wall-clock time in a zone happens. In the hour repeated
// when the clocks go back it happens twice: this is the first time. In the
// hour skipped when they go forward it doesn't happen: this is that time
// read with the offset from before the change (an hour later on the new
// clock), as JavaScript's Temporal does.
function instantOf(wall: number, zone: string): number {
  const offsetAt = (instant: number) => wallClock(instant, zone).ms - Math.floor(instant / 1000) * 1000;
  // The offsets a day either side cover both sides of any clock change.
  const candidates = [wall - offsetAt(wall - DAY), wall - offsetAt(wall + DAY)];
  const exact = candidates.filter((t) => wallClock(t, zone).ms === wall);
  return exact.length ? Math.min(...exact) : Math.max(...candidates);
}

// Whether the shift is on now, and the instant it last started or ended.
// Looks back eight days: far enough to reach the latest edge of any
// schedule, including a shift begun the day before. Equal start and end
// times are a 24-hour shift.
function shiftNow(hours: WorkHours, zone: string, now: Date): { onShift: boolean; lastEdge: number } | null {
  if (!hours.work_days?.length || !hours.work_start || !hours.work_end) return null;
  const start = timeToMinutes(hours.work_start);
  const end = timeToMinutes(hours.work_end);
  if (start === null || end === null) return null;

  const { ms: nowMs, isoDay: today } = wallClock(now.getTime(), zone);
  const midnight = nowMs - (nowMs % DAY);
  let onShift = false;
  let lastEdge = -Infinity;
  for (let back = 0; back <= 7; back++) {
    const isoDay = ((today - 1 - back + 7 * 2) % 7) + 1;
    if (!hours.work_days.includes(isoDay)) continue;
    const dayStart = midnight - back * DAY;
    const startsAt = dayStart + start * MINUTE;
    const endsAt = dayStart + end * MINUTE + (end <= start ? DAY : 0);
    if (startsAt <= nowMs && nowMs < endsAt) onShift = true;
    for (const edge of [startsAt, endsAt]) if (edge <= nowMs && edge > lastEdge) lastEdge = edge;
  }
  return { onShift, lastEdge: lastEdge === -Infinity ? lastEdge : instantOf(lastEdge, zone) };
}

export type PresenceShown = { presence: Presence; source: "schedule" | "manual" | "signed_out" };

// presence_set_at after signing out: Offline holds, whatever the schedule,
// until they sign in again (sign_out_presence()).
const SIGNED_OUT = "infinity";

// The status to show, and what decided it: the schedule, the person's own
// pick, or signing out. A pick made since the shift last started or ended
// holds; an older one gives way to the schedule. No schedule: the pick
// always holds.
export function shownPresence(profile: PresenceSource, now: Date = new Date()): PresenceShown {
  if (profile.presence_set_at === SIGNED_OUT) return { presence: profile.presence, source: "signed_out" };
  const shift = shiftNow(profile, profile.timezone, now);
  if (!shift) return { presence: profile.presence, source: "manual" };
  if (profile.presence_set_at && Date.parse(profile.presence_set_at) >= shift.lastEdge) {
    return { presence: profile.presence, source: "manual" };
  }
  return { presence: shift.onShift ? "online" : "offline", source: "schedule" };
}

// A row read from profiles with presence replaced by the status to show
// now, so no reader shows the bare last pick by mistake. app/lib/db/ calls
// this on every row it returns with a presence.
export function withShownPresence<T extends PresenceSource>(
  row: T,
  now: Date = new Date(),
): Omit<T, "presence"> & { presence: Presence; presence_source: PresenceShown["source"] } {
  const shown = shownPresence(row, now);
  return { ...row, presence: shown.presence, presence_source: shown.source };
}
