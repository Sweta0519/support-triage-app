import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { computeSla, formatDuration } from "../app/lib/sla";
import { login, requireEnv } from "./helpers";

// First-response SLA. The rules are a pure function, tested directly; one
// browser test checks they reach the queue and the ticket page. Tickets are
// seeded with a back-dated created_at via the service role -- no waiting.

test.use({ storageState: { cookies: [], origins: [] } });

const NOW = new Date("2026-10-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

test.describe("computeSla", () => {
  test("each priority gets its own target, and an unprioritised ticket counts as normal", () => {
    const due = (priority: string | null) =>
      computeSla(
        { created_at: hoursAgo(0), first_response_at: null, status: "new", triage_state: { priority } },
        NOW
      )?.dueAt.toISOString();
    expect(due("urgent")).toBe("2026-10-09T13:00:00.000Z");
    expect(due("high")).toBe("2026-10-09T16:00:00.000Z");
    expect(due("normal")).toBe("2026-10-09T20:00:00.000Z");
    expect(due("low")).toBe("2026-10-10T12:00:00.000Z");
    expect(due(null)).toBe("2026-10-09T20:00:00.000Z");
  });

  test("a waiting ticket is on track, then at risk in the last quarter, then breached", () => {
    const state = (createdHoursAgo: number) =>
      computeSla(
        { created_at: hoursAgo(createdHoursAgo), first_response_at: null, status: "assigned", triage_state: { priority: "high" } },
        NOW
      )?.state;
    expect(state(1)).toBe("on_track"); // 3h of 4h left
    expect(state(3)).toBe("at_risk"); // exactly 1h (a quarter) left
    expect(state(5)).toBe("breached");
  });

  test("an answered ticket is met or missed by how long the first reply took", () => {
    const sla = (repliedAfterHours: number) =>
      computeSla(
        {
          created_at: hoursAgo(10),
          first_response_at: hoursAgo(10 - repliedAfterHours),
          status: "resolved",
          triage_state: { priority: "urgent" },
        },
        NOW
      );
    expect(sla(0.5)).toMatchObject({ state: "met", responseMs: 30 * 60 * 1000 });
    expect(sla(2)?.state).toBe("missed");
  });

  test("a resolved or closed ticket that never got a reply has no SLA", () => {
    for (const status of ["resolved", "closed"] as const) {
      expect(
        computeSla({ created_at: hoursAgo(30), first_response_at: null, status, triage_state: { priority: "low" } }, NOW)
      ).toBeNull();
    }
  });

  test("durations read compactly", () => {
    expect(formatDuration(20 * 1000)).toBe("1m");
    expect(formatDuration(45 * 60 * 1000)).toBe("45m");
    expect(formatDuration(-(3 * 60 + 20) * 60 * 1000)).toBe("3h 20m");
    expect(formatDuration(52 * 60 * 60 * 1000)).toBe("2d 4h");
  });
});

test("an overdue ticket shows as overdue in the queue and on the ticket page", async ({ page }) => {
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: customer, error: customerError } = await db
    .from("profiles")
    .select("id")
    .eq("email", requireEnv("TEST_USER_EMAIL"))
    .single();
  if (customerError) throw new Error(customerError.message);

  // High priority (4h target), filed 5h ago, never answered: 1h overdue.
  const subject = `SLA probe ${Date.now()}`;
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({
      customer_id: customer.id,
      subject,
      body: "Nobody has answered me yet.",
      created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // Removed afterwards so repeated runs don't pile probes into the shared
  // project's unassigned queue (comments, events, triage state cascade).
  try {
    // .single() fails loudly if the triage-state row isn't there yet,
    // instead of the queue assertion failing for an unclear reason.
    const { error: stateError } = await db
      .from("ticket_triage_state")
      .update({ priority: "high", triage_status: "completed" })
      .eq("ticket_id", ticket.id)
      .select("ticket_id")
      .single();
    if (stateError) throw new Error(stateError.message);

    await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
    await page.goto("/queue?filter=unassigned");
    const row = page.getByRole("link", { name: new RegExp(subject) });
    // Minutes tick on between the insert and the render (a cold dev server
    // can take well over 30s to compile /queue), so allow "1h 1m" etc.
    await expect(row.getByText(/^Overdue 1h( \d+m)?$/)).toBeVisible();

    await row.click();
    await expect(
      page.getByText(/First reply overdue by 1h( \d+m)? \(4h target for high priority\)\./)
    ).toBeVisible();
  } finally {
    await db.from("tickets").delete().eq("id", ticket.id);
  }
});
