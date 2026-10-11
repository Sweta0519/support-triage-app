import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { QueueTicketSummary } from "../app/lib/db/tickets";
import { isFrustrated, matchesSearch, parseQueueView, sortQueue } from "../app/lib/queue";
import { login, requireEnv } from "./helpers";

// The queue's cards, search, status filter and sort. The view logic is a
// pure function, tested directly; one browser test seeds a triaged ticket
// (service role, no OpenRouter) and checks its card end to end.

test.use({ storageState: { cookies: [], origins: [] } });

const NOW = new Date("2026-10-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000).toISOString();

function ticket(overrides: Partial<QueueTicketSummary> & { id: string }): QueueTicketSummary {
  return {
    number: 1000,
    subject: "Something",
    status: "new",
    created_at: hoursAgo(1),
    assignee_id: null,
    first_response_at: null,
    triage_state: null,
    latest_triage: null,
    ...overrides,
  };
}

test.describe("queue view logic", () => {
  test("parseQueueView falls back to the default view on anything unknown", () => {
    expect(parseQueueView({})).toEqual({ status: "all", sort: "sla", q: "" });
    expect(parseQueueView({ status: "closed", sort: "random", q: "  hi  " })).toEqual({
      status: "all",
      sort: "sla",
      q: "hi",
    });
    expect(parseQueueView({ status: ["in_progress", "new"], sort: "oldest" })).toMatchObject({
      status: "in_progress",
      sort: "oldest",
    });
  });

  test("search matches the number, subject, AI summary and category", () => {
    const t = ticket({
      id: "a",
      number: 1042,
      subject: "Invoice is wrong",
      triage_state: {
        triage_status: "completed",
        priority: "high",
        category: "feature_request",
        team: "billing",
        reviewed_by: null,
        reviewed_at: null,
        reviewed_result_id: null,
      },
      latest_triage: { summary: "Customer was double charged", is_escalation_risk: false, frustration: 2, needs_human_review: false },
    });
    for (const q of ["", "1042", "#1042", "invoice", "DOUBLE CHARGED", "feature request", "billing"]) {
      expect(matchesSearch(t, q), q).toBe(true);
    }
    // "#" means the number only, even if the subject contains the digits.
    expect(matchesSearch({ ...t, subject: "Ref 1042-B" , number: 7 }, "#1042")).toBe(false);
    expect(matchesSearch({ ...t, subject: "Ref 1042-B", number: 7 }, "1042")).toBe(true);
    for (const q of ["104", "refund"]) {
      expect(matchesSearch(t, q), q).toBe(false);
    }
  });

  test("'Most urgent' puts waiting tickets first, most overdue at the top", () => {
    const tickets = [
      ticket({ id: "answered", created_at: hoursAgo(50), first_response_at: hoursAgo(49) }),
      ticket({ id: "due-soon", created_at: hoursAgo(7) }), // normal 8h: 1h left
      ticket({ id: "overdue-10h", created_at: hoursAgo(18) }),
      ticket({ id: "overdue-2h", created_at: hoursAgo(10) }),
      ticket({ id: "plenty-left", created_at: hoursAgo(1) }),
    ];
    expect(sortQueue(tickets, "sla", NOW).map((t) => t.id)).toEqual([
      "overdue-10h",
      "overdue-2h",
      "due-soon",
      "plenty-left",
      "answered",
    ]);
    expect(sortQueue(tickets, "newest", NOW)[0].id).toBe("plenty-left");
    expect(sortQueue(tickets, "oldest", NOW)[0].id).toBe("answered");
  });

  test("only high frustration is flagged", () => {
    expect([null, 1, 3, 4, 5].map(isFrustrated)).toEqual([false, false, false, true, true]);
  });
});

test("a triaged ticket's card shows its number, AI summary and AI flags, and search finds it", async ({ page }) => {
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

  const subject = `Queue card probe ${Date.now()}`;
  const { data: created, error } = await db
    .from("tickets")
    .insert({ customer_id: customer.id, subject, body: "The export keeps failing and I have a deadline." })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);

  try {
    const { error: runError } = await db.from("triage_results").insert({
      ticket_id: created.id,
      model: "test/seeded",
      prompt_version: "test",
      summary: "Export fails before the customer's deadline.",
      priority: "urgent",
      category: "bug",
      team: "engineering",
      frustration: 5,
      is_escalation_risk: true,
      needs_human_review: true,
      confidence: 0.4,
    });
    if (runError) throw new Error(runError.message);
    const { error: stateError } = await db
      .from("ticket_triage_state")
      .update({ priority: "urgent", category: "bug", team: "engineering", triage_status: "completed" })
      .eq("ticket_id", created.id)
      .select("ticket_id")
      .single();
    if (stateError) throw new Error(stateError.message);

    await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

    // Search by number, with the "#" an agent would type.
    await page.goto(`/queue?q=${encodeURIComponent(`#${created.number}`)}`);
    const card = page.getByRole("link", { name: new RegExp(subject) });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(`#${created.number}`, { exact: true })).toBeVisible();
    await expect(card.getByText("Export fails before the customer's deadline.")).toBeVisible();
    for (const chip of ["urgent", "bug", "Escalation risk", "Frustrated", "AI unsure"]) {
      await expect(card.getByText(chip, { exact: true })).toBeVisible();
    }

    // The status filter keeps the search; a status the ticket isn't in hides it.
    await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: /^assigned/i }).click();
    await expect(page).toHaveURL(/status=assigned/);
    await expect(page).toHaveURL(/q=%23/);
    await expect(page.getByRole("link", { name: new RegExp(subject) })).toHaveCount(0);
  } finally {
    await db.from("tickets").delete().eq("id", created.id);
  }
});
