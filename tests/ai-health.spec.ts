import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { aiTriageBannerCopy, aiTriageHealth, FAILING_STREAK, FAILING_WINDOW_MS } from "../app/lib/triage-status";
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

test("health: off without a key; failing only on a recent streak; otherwise ok", () => {
  expect(aiTriageHealth(false, [], now)).toEqual({ kind: "off" });
  expect(aiTriageHealth(true, [], now)).toEqual({ kind: "ok" });
  // A streak of FAILING_STREAK failures, the newest recent: failing, with its reason.
  const streak = [run("failed", 1, "provider_unavailable"), run("failed", 5, "timeout"), run("failed", 9)];
  expect(aiTriageHealth(true, streak, now)).toEqual({ kind: "failing", reason: "provider_unavailable" });
  // One success among them is enough to say it works.
  expect(aiTriageHealth(true, [run("failed", 1), run("completed", 5), run("failed", 9)], now)).toEqual({ kind: "ok" });
  // Fewer finished runs than the streak: not enough evidence.
  expect(aiTriageHealth(true, streak.slice(0, FAILING_STREAK - 1), now)).toEqual({ kind: "ok" });
  // An old streak (nothing has run since): not shouted about.
  const old = FAILING_WINDOW_MS / 60_000 + 1;
  expect(aiTriageHealth(true, [run("failed", old), run("failed", old + 1), run("failed", old + 2)], now)).toEqual({ kind: "ok" });
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
  const db = service();
  const { data: customer } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const ids: string[] = [];
  try {
    for (let i = 0; i < FAILING_STREAK; i++) {
      const { data: ticket, error } = await db
        .from("tickets")
        .insert({ customer_id: customer!.id, subject: `AI health probe ${Date.now()}-${i}`, body: "Health probe body" })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      ids.push(ticket.id);
      // Newest of all finished runs: claimed a little in the future, so a
      // real run finishing meanwhile can't sit above the seeded streak.
      const claimedAt = new Date(Date.now() + 10 * 60_000 - i * 1000).toISOString();
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
