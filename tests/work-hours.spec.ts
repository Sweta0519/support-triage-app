import { test, expect } from "@playwright/test";

import { shownPresence, type PresenceSource } from "../app/lib/work-hours";

// SUP-85: the status working hours show. A pure function, so no browser
// or database is involved. 2026-10-21 is a Wednesday; Berlin is UTC+2
// until 2026-10-25, then UTC+1.

const officeHours: PresenceSource = {
  presence: "online",
  presence_set_at: null,
  timezone: "Europe/Berlin",
  work_days: [1, 2, 3, 4, 5],
  work_start: "09:00:00",
  work_end: "17:00:00",
};

const at = (iso: string) => new Date(iso);

test("no working hours: the person's own pick always shows", () => {
  const none = { ...officeHours, presence: "away" as const, work_days: null, work_start: null, work_end: null };
  expect(shownPresence(none, at("2026-10-21T08:00:00Z"))).toEqual({ presence: "away", source: "manual" });
  expect(shownPresence(none, at("2026-10-24T23:00:00Z"))).toEqual({ presence: "away", source: "manual" });
});

test("Online during the shift, Offline outside it, in their timezone", () => {
  // 10:00 in Berlin on a Wednesday.
  expect(shownPresence(officeHours, at("2026-10-21T08:00:00Z"))).toEqual({ presence: "online", source: "schedule" });
  // 18:00 in Berlin.
  expect(shownPresence(officeHours, at("2026-10-21T16:00:00Z")).presence).toBe("offline");
  // Saturday 10:00.
  expect(shownPresence(officeHours, at("2026-10-24T08:00:00Z")).presence).toBe("offline");
  // The same instant is 04:00 in New York: before their shift.
  expect(shownPresence({ ...officeHours, timezone: "America/New_York" }, at("2026-10-21T08:00:00Z")).presence).toBe(
    "offline",
  );
  // After the clocks go back: Monday 09:30 in Berlin is 08:30 UTC.
  expect(shownPresence(officeHours, at("2026-10-26T08:30:00Z")).presence).toBe("online");
  expect(shownPresence(officeHours, at("2026-10-26T07:30:00Z")).presence).toBe("offline");
});

test("the start time is on shift, the end time isn't", () => {
  expect(shownPresence(officeHours, at("2026-10-21T07:00:00Z")).presence).toBe("online");
  expect(shownPresence(officeHours, at("2026-10-21T15:00:00Z")).presence).toBe("offline");
});

test("a pick holds until the shift next starts or ends", () => {
  // Away picked at 09:30 on Wednesday.
  const away = { ...officeHours, presence: "away" as const, presence_set_at: "2026-10-21T07:30:00Z" };
  expect(shownPresence(away, at("2026-10-21T08:00:00Z"))).toEqual({ presence: "away", source: "manual" });
  // 17:00 has passed: the schedule takes over.
  expect(shownPresence(away, at("2026-10-21T15:30:00Z"))).toEqual({ presence: "offline", source: "schedule" });

  // Signed out (Offline) at noon: Offline stays until the end of the
  // shift, then the next shift's start brings Online back.
  const signedOut = { ...officeHours, presence: "offline" as const, presence_set_at: "2026-10-21T10:00:00Z" };
  expect(shownPresence(signedOut, at("2026-10-21T12:00:00Z"))).toEqual({ presence: "offline", source: "manual" });
  expect(shownPresence(signedOut, at("2026-10-22T07:05:00Z"))).toEqual({ presence: "online", source: "schedule" });

  // Online picked on Saturday holds through the weekend, until Monday 09:00.
  const weekend = { ...officeHours, presence: "online" as const, presence_set_at: "2026-10-24T08:00:00Z" };
  expect(shownPresence(weekend, at("2026-10-25T12:00:00Z"))).toEqual({ presence: "online", source: "manual" });
  expect(shownPresence(weekend, at("2026-10-26T08:05:00Z"))).toEqual({ presence: "online", source: "schedule" });
  expect(shownPresence(weekend, at("2026-10-26T16:05:00Z"))).toEqual({ presence: "offline", source: "schedule" });
});

test("an end time before the start runs the shift into the next day", () => {
  // Monday nights, 22:00 to 06:00, in UTC.
  const nights: PresenceSource = {
    ...officeHours,
    timezone: "UTC",
    work_days: [1],
    work_start: "22:00:00",
    work_end: "06:00:00",
  };
  expect(shownPresence(nights, at("2026-10-26T21:30:00Z")).presence).toBe("offline");
  expect(shownPresence(nights, at("2026-10-26T23:00:00Z")).presence).toBe("online");
  // Tuesday 03:00 is still Monday's shift.
  expect(shownPresence(nights, at("2026-10-27T03:00:00Z")).presence).toBe("online");
  expect(shownPresence(nights, at("2026-10-27T07:00:00Z")).presence).toBe("offline");
  // Tuesday night isn't a shift.
  expect(shownPresence(nights, at("2026-10-27T23:00:00Z")).presence).toBe("offline");
});
