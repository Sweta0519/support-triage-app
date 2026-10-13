import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { QueueTicketSummary } from "../app/lib/db/tickets";
import { isFrustrated, matchesSearch, parseQueueView, sortQueue } from "../app/lib/queue";
import { safeQueueReturn } from "../app/lib/queue-filters";
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
        updated_at: "2026-10-01T00:00:00Z",
        claimed_at: null,
        failure_reason: null,
      },
      latest_triage: { id: "run-1", summary: "Customer was double charged", is_escalation_risk: false, frustration: 2, needs_human_review: false },
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

  test("a claim only ever returns to a /queue URL", () => {
    for (const ok of ["/queue", "/queue?q=%231042", "/queue?filter=mine&status=new&sort=oldest&q=billing"]) {
      expect(safeQueueReturn(ok), ok).toBe(ok);
    }
    for (const bad of ["", "//evil.example", "https://evil.example/queue", "/queue/../admin", "/queue?x=//evil", "/queue\\evil", "/queue?x=1\r\nSet-Cookie: a=b", "/queuex", "/tickets/1"]) {
      expect(safeQueueReturn(bad), JSON.stringify(bad)).toBe("/queue");
    }
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
    const seedRun = async (summary: string) => {
      const { data, error: runError } = await db
        .from("triage_results")
        .insert({
          ticket_id: created.id,
          model: "test/seeded",
          prompt_version: "test",
          summary,
          priority: "urgent",
          category: "bug",
          team: "engineering",
          frustration: 5,
          is_escalation_risk: true,
          needs_human_review: true,
          confidence: 0.4,
        })
        .select("id")
        .single();
      if (runError) throw new Error(runError.message);
      return data.id as string;
    };
    const firstRun = await seedRun("Export fails before the customer's deadline.");
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
    // The labels sit on the card below the link, as their own button (SUP-40).
    const cardArea = page.getByRole("listitem").filter({ has: card });
    await expect(card.getByText(`#${created.number}`, { exact: true })).toBeVisible();
    await expect(card.getByText("Export fails before the customer's deadline.")).toBeVisible();
    // Linear-style card (SUP-38): priority as an icon (named for screen
    // readers). The AI's read (SUP-41) shows its most important signal as
    // ✦ text, the rest as "+N" with a tooltip naming them all -- and it
    // isn't a button: only team labels open the label picker.
    await expect(card.getByText("Urgent priority", { exact: true })).toBeAttached();
    const aiRead = cardArea.locator('[title^="AI\'s read of this ticket:"]');
    await expect(aiRead).toHaveAttribute(
      "title",
      "AI's read of this ticket: Escalation risk, AI unsure (The AI flagged its own triage for a human to check), Bug, Frustrated"
    );
    await expect(aiRead.getByText("Escalation risk", { exact: true })).toBeVisible();
    // "AI unsure" is never hidden behind "+N" (SUP-38): it shows beside the top signal.
    await expect(aiRead.getByText("AI unsure", { exact: true })).toBeVisible();
    await expect(aiRead.getByText("+2", { exact: true })).toBeVisible();
    // Read-only: it sits outside every button on the card.
    await expect(aiRead.locator("xpath=ancestor::button")).toHaveCount(0);

    // The ticket page header shows the same AI read, labelled as AI-estimated,
    // and the SLA as a banner.
    await card.click();
    const sentiment = page.getByLabel("AI-estimated customer sentiment");
    await expect(sentiment.getByText("Escalation risk", { exact: true })).toBeVisible();
    await expect(sentiment.getByText("Frustrated 5/5", { exact: true })).toBeVisible();
    await expect(sentiment.getByText("AI-estimated", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "First reply on track." })).toBeVisible();
    await page.goto(`/queue?q=${encodeURIComponent(`#${created.number}`)}`);

    // The status filter keeps the search; a status the ticket isn't in hides it.
    await page.getByRole("navigation", { name: "Filter by status" }).getByRole("link", { name: /^assigned/i }).click();
    await expect(page).toHaveURL(/status=assigned/);
    await expect(page).toHaveURL(/q=%23/);
    await expect(page.getByRole("link", { name: new RegExp(subject) })).toHaveCount(0);

    // Once staff review that run, the review chip goes away...
    const { error: reviewError } = await db
      .from("ticket_triage_state")
      .update({ reviewed_at: new Date().toISOString(), reviewed_result_id: firstRun })
      .eq("ticket_id", created.id);
    if (reviewError) throw new Error(reviewError.message);
    await page.goto(`/queue?q=${encodeURIComponent(`#${created.number}`)}`);
    await expect(aiRead).toHaveAttribute("title", "AI's read of this ticket: Escalation risk, Bug, Frustrated");
    await expect(aiRead.getByText("Escalation risk", { exact: true })).toBeVisible();

    // ...and comes back when a newer run lands that nobody has checked.
    await new Promise((resolve) => setTimeout(resolve, 10)); // a later created_at than the first run
    await seedRun("Re-run: export still failing.");
    await page.reload();
    await expect(card.getByText("Re-run: export still failing.")).toBeVisible();
    await expect(aiRead).toHaveAttribute("title", /AI unsure/);
  } finally {
    await db.from("tickets").delete().eq("id", created.id);
  }
});

test("Claim on a card opens the ticket; a lost race says so instead of doing nothing", async ({ page }) => {
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: customer } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const { data: admin } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_ADMIN_EMAIL")).single();
  const seed = async (subject: string) => {
    const { data, error } = await db
      .from("tickets")
      .insert({ customer_id: customer!.id, subject, body: "Claim probe." })
      .select("id, number")
      .single();
    if (error) throw new Error(error.message);
    return data;
  };
  const won = await seed(`Claim probe ${Date.now()}`);
  const lost = await seed(`Lost claim probe ${Date.now()}`);
  // Work had started, then an admin unassigned it: claiming must not move
  // it back to "assigned".
  const started = await seed(`Started claim probe ${Date.now()}`);
  const { error: startError } = await db.from("tickets").update({ status: "in_progress" }).eq("id", started.id);
  if (startError) throw new Error(startError.message);

  try {
    await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

    // Success: lands on the ticket, with the queue tab kept for the breadcrumb.
    await page.goto(`/queue?filter=unassigned&q=${encodeURIComponent(`#${won.number}`)}`);
    await page.getByRole("button", { name: new RegExp(`^Claim #${won.number}:`) }).click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${won.id}\\?from=unassigned$`));
    await expect(page.getByText("Assigned to you")).toBeVisible();

    // An in-progress ticket keeps its status when claimed.
    await page.goto(`/queue?q=${encodeURIComponent(`#${started.number}`)}`);
    await page.getByRole("button", { name: new RegExp(`^Claim #${started.number}:`) }).click();
    await expect(page).toHaveURL(new RegExp(`/tickets/${started.id}$`));
    await expect(page.getByText("Assigned to you")).toBeVisible();
    const { data: startedNow } = await db.from("tickets").select("status, assignee_id").eq("id", started.id).single();
    expect(startedNow?.status).toBe("in_progress");

    // Lost race: someone else claims it after the queue rendered.
    await page.goto(`/queue?q=${encodeURIComponent(`#${lost.number}`)}`);
    const claim = page.getByRole("button", { name: new RegExp(`^Claim #${lost.number}:`) });
    await expect(claim).toBeVisible();
    const { error } = await db.from("tickets").update({ assignee_id: admin!.id, status: "assigned" }).eq("id", lost.id);
    if (error) throw new Error(error.message);
    await claim.click();
    // Back on the same queue view (search kept), with a notice, and the
    // card gone: the ticket now belongs to someone else.
    await expect(page.getByRole("status").filter({ hasText: "That ticket is no longer available to claim." })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(`^Claim #${lost.number}:`) })).toHaveCount(0);
    // The notice is dropped from the URL once shown, so a reload doesn't repeat it.
    await expect(page).not.toHaveURL(/notice=/);
    await page.reload();
    await expect(page.getByText("That ticket is no longer available to claim.")).toHaveCount(0);
  } finally {
    await db.from("tickets").delete().in("id", [won.id, lost.id, started.id]);
  }
});

test("the AI's read: most important signal first", async () => {
  const { aiSignals } = await import("../app/components/CardBits");
  const all = aiSignals({ category: "feature_request", escalation: true, frustrated: true, review: "unsure" });
  expect(all.map((l) => l.text)).toEqual(["Escalation risk", "AI unsure", "Feature request", "Frustrated"]);
  const calm = aiSignals({ category: "billing", escalation: false, frustrated: false, review: null });
  expect(calm.map((l) => l.text)).toEqual(["Billing"]);
  expect(aiSignals({ category: null, escalation: false, frustrated: false, review: "unreviewed" }).map((l) => l.text)).toEqual([
    "AI unreviewed",
  ]);
});
