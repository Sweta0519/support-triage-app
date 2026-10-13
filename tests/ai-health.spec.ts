import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  aiTriageBannerCopy,
  aiTriageHealth,
  FAILING_STREAK,
  FAILING_WINDOW_MS,
  STALE_TRIAGE_MS,
} from "../app/lib/triage-status";
import { login, requireEnv } from "./helpers";

// SUP-36: without the model the product is a plain ticket inbox, so staff
// are told when AI triage is off or failing, on every page.

test.use({ storageState: { cookies: [], origins: [] } });

const now = Date.parse("2026-10-13T12:00:00Z");
const run = (status: string, minutesAgo: number, reason: string | null = null) => ({
  triage_status: status,
  claimed_at: new Date(now - minutesAgo * 60_000).toISOString(),
  failure_reason: reason,
});

test("health: off without a key; failing only on a recent streak of provider failures; otherwise ok", () => {
  expect(aiTriageHealth(false, [], now)).toEqual({ kind: "off" });
  expect(aiTriageHealth(true, [], now)).toEqual({ kind: "ok" });
  // A streak of provider failures, all recent: failing, with the newest reason.
  const streak = [
    run("failed", 1, "provider_unavailable"),
    run("failed", 5, "timeout"),
    run("failed", 9, "rate_limited"),
  ];
  expect(aiTriageHealth(true, streak, now)).toEqual({ kind: "failing", reason: "provider_unavailable" });
  // One success among them is enough to say it works.
  expect(aiTriageHealth(true, [run("failed", 1, "timeout"), run("completed", 5), run("failed", 9, "timeout")], now)).toEqual({
    kind: "ok",
  });
  // Fewer runs than the streak: not enough evidence.
  expect(aiTriageHealth(true, streak.slice(0, FAILING_STREAK - 1), now)).toEqual({ kind: "ok" });
  // The whole streak must be recent, the oldest included.
  const old = FAILING_WINDOW_MS / 60_000 + 1;
  expect(aiTriageHealth(true, [run("failed", 1, "timeout"), run("failed", 2, "timeout"), run("failed", old, "timeout")], now)).toEqual({
    kind: "ok",
  });
  // Content-shaped failures don't count: a customer can't raise the alarm
  // for the whole team by filing tickets the model can't read.
  expect(
    aiTriageHealth(true, [run("failed", 1, "invalid_response"), run("failed", 2, "error"), run("failed", 3, "invalid_response")], now)
  ).toEqual({ kind: "ok" });
  // A run stuck in "processing" past the stall threshold counts as a failure
  // (a hung provider gets the function killed before it records "failed")...
  const stalled = STALE_TRIAGE_MS / 60_000 + 1;
  expect(aiTriageHealth(true, [run("processing", stalled), run("failed", stalled + 1, "timeout"), run("processing", stalled + 2)], now)).toEqual({
    kind: "failing",
    reason: "timeout",
  });
  // ...a live one is no verdict yet, and is skipped.
  expect(aiTriageHealth(true, [run("processing", 1), ...streak], now)).toEqual({ kind: "failing", reason: "provider_unavailable" });
});

test("the banner says what's missing, and only admins get the fix", () => {
  expect(aiTriageBannerCopy({ kind: "ok" }, true)).toBeNull();
  const off = aiTriageBannerCopy({ kind: "off" }, false)!;
  expect(off.title).toBe("AI triage is off.");
  expect(off.body).toContain("categorised, prioritised, routed to a team, checked for duplicates or given a draft reply");
  expect(off.body).not.toContain("OPENROUTER_API_KEY");
  expect(aiTriageBannerCopy({ kind: "off" }, true)!.body).toContain("OPENROUTER_API_KEY");
  const failing = aiTriageBannerCopy({ kind: "failing", reason: "rate_limited" }, true)!;
  expect(failing.title).toBe("AI triage is failing.");
  expect(failing.body).toContain("The AI provider was rate-limiting requests.");
  // An unknown reason never reaches the page as raw text.
  expect(aiTriageBannerCopy({ kind: "failing", reason: "OpenRouter said: secret" }, true)!.body).not.toContain("secret");
});

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

test("a streak of failed runs puts the banner on staff pages, never on customers'", async ({ browser }) => {
  // With no key the banner says "off", not "failing": nothing to test here.
  test.skip(!process.env.OPENROUTER_API_KEY, "needs OPENROUTER_API_KEY, like the server it tests");
  const db = service();
  const { data: customer } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const ids: string[] = [];
  try {
    for (let i = 0; i < FAILING_STREAK; i++) {
      const { data: ticket, error } = await db
        .from("tickets")
        // Ends in a 13-digit timestamp, so the suite's cleanup teardown
        // deletes it even if this test is killed before its finally runs.
        .insert({ customer_id: customer!.id, subject: `AI health probe ${i} ${Date.now()}`, body: "Health probe body" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids.push(ticket.id);
      // Claimed "now" (this project runs last, alone, so no real run lands
      // in between). Never in the future: a leftover row from a killed run
      // would then hold the banner up for everyone for a day.
      const claimedAt = new Date(Date.now() - i * 1000).toISOString();
      await db.from("ticket_triage_state").delete().eq("ticket_id", ticket.id);
      const { error: stateError } = await db.from("ticket_triage_state").insert({
        ticket_id: ticket.id,
        triage_status: "failed",
        failure_reason: "provider_unavailable",
        claim_id: crypto.randomUUID(),
        claimed_at: claimedAt,
      });
      if (stateError) throw new Error(stateError.message);
    }

    const staff = await (await browser.newContext()).newPage();
    await login(staff, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
    await staff.goto("/queue");
    const banner = staff.getByRole("status", { name: "AI triage status" });
    await expect(banner).toContainText("AI triage is failing.");
    await expect(banner).toContainText("The AI provider was unavailable.");
    // On every staff page, not just the queue.
    await staff.goto("/notes");
    await expect(banner).toBeVisible();

    const customerPage = await (await browser.newContext()).newPage();
    await login(customerPage, requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
    await customerPage.goto("/tickets");
    await expect(customerPage.getByText("AI triage is failing.")).toHaveCount(0);

    // Once the streak is gone, so is the banner.
    await db.from("tickets").delete().in("id", ids);
    ids.length = 0;
    await staff.goto("/queue");
    await expect(banner).toHaveCount(0);
  } finally {
    if (ids.length) await db.from("tickets").delete().in("id", ids);
  }
});
