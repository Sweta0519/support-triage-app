import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { effectiveTriageStatus, STALE_TRIAGE_MS } from "../app/lib/triage-status";
import { login, requireEnv } from "./helpers";

// SUP-30: a triage run whose function died stays "pending"/"processing";
// after STALE_TRIAGE_MS it shows as stalled and can be re-run.

test.use({ storageState: { cookies: [], origins: [] } });

test("effective status: only a long-stuck run is stalled, and never with AI off", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const old = ago(STALE_TRIAGE_MS + 1000);
  const recent = ago(60_000);
  const at = { now };
  // processing: judged by when the run took its claim.
  expect(effectiveTriageStatus({ triage_status: "processing", claimed_at: old, updated_at: recent }, at)).toBe("stalled");
  expect(effectiveTriageStatus({ triage_status: "processing", claimed_at: recent, updated_at: old }, at)).toBe("processing");
  // pending: nothing claimed it; judged by updated_at.
  expect(effectiveTriageStatus({ triage_status: "pending", updated_at: old }, at)).toBe("stalled");
  expect(effectiveTriageStatus({ triage_status: "pending", updated_at: recent }, at)).toBe("pending");
  // Finished runs are never stalled.
  expect(effectiveTriageStatus({ triage_status: "completed", updated_at: old }, at)).toBe("completed");
  expect(effectiveTriageStatus({ triage_status: "failed", updated_at: old }, at)).toBe("failed");
  // With AI off, pending is expected: not stalled, nothing to re-run.
  expect(effectiveTriageStatus({ triage_status: "pending", updated_at: old }, { now, aiConfigured: false })).toBe("pending");
  expect(effectiveTriageStatus(null, at)).toBe("pending");
});

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A ticket whose triage run has been "processing" since `msAgo`. The
// timestamps can't be backdated by an update (a trigger sets updated_at to
// now()), so the state row is replaced by an insert.
async function seedProcessing(subject: string, msAgo: number) {
  const db = service();
  const { data: customer, error: customerError } = await db
    .from("profiles")
    .select("id")
    .eq("email", requireEnv("TEST_USER_EMAIL"))
    .single();
  if (customerError) throw new Error(customerError.message);
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: customer.id, subject, body: "My invoice shows the wrong amount for September." })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  const { error: deleteError } = await db.from("ticket_triage_state").delete().eq("ticket_id", ticket.id);
  if (deleteError) throw new Error(deleteError.message);
  const since = new Date(Date.now() - msAgo).toISOString();
  const { error: stateError } = await db.from("ticket_triage_state").insert({
    ticket_id: ticket.id,
    triage_status: "processing",
    claim_id: crypto.randomUUID(),
    claimed_at: since,
    updated_at: since,
  });
  if (stateError) throw new Error(stateError.message);
  return ticket as { id: string; number: number };
}

test("a stalled run is shown as stalled and can be re-run; a live one can't", async ({ page }) => {
  test.setTimeout(120_000);
  requireEnv("OPENROUTER_API_KEY");
  const stalled = await seedProcessing(`Stalled triage probe ${Date.now()}`, STALE_TRIAGE_MS + 60_000);
  const live = await seedProcessing(`Live triage probe ${Date.now()}`, 10_000);
  try {
    await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

    // The queue card says so, instead of "Awaiting AI triage" forever.
    await page.goto(`/queue?filter=all&q=${encodeURIComponent(`#${stalled.number}`)}`);
    await expect(page.getByText(/AI triage stalled/)).toBeVisible();

    // A live run: still "Running...", no re-run that could race it.
    await page.goto(`/tickets/${live.id}`);
    const livePanel = page.locator("section", { hasText: "AI triage" }).first();
    await expect(livePanel.getByText("Running...")).toBeVisible();
    await expect(livePanel.getByRole("button", { name: "Re-run" })).toHaveCount(0);

    // The stalled run: explained, with Re-run -- which actually completes.
    await page.goto(`/tickets/${stalled.id}`);
    const panel = page.locator("section", { hasText: "AI triage" }).first();
    await expect(panel.getByText(/Triage stalled/)).toBeVisible();
    await panel.getByRole("button", { name: "Re-run" }).click();
    await expect
      .poll(
        async () =>
          (await service().from("ticket_triage_state").select("triage_status").eq("ticket_id", stalled.id).single()).data
            ?.triage_status,
        { timeout: 90_000 }
      )
      .toBe("completed");
  } finally {
    await service().from("tickets").delete().in("id", [stalled.id, live.id]);
  }
});

// SUP-32: a failed run says why, in words, with no provider error text.
test("a failed run shows staff why it failed", async ({ page }) => {
  const ticket = await seedProcessing(`Failed triage probe ${Date.now()}`, 10_000);
  try {
    const { error } = await service()
      .from("ticket_triage_state")
      .update({ triage_status: "failed", failure_reason: "provider_unavailable" })
      .eq("ticket_id", ticket.id);
    expect(error).toBeNull();
    await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByText("Triage failed. The AI provider was unavailable. You can re-run it.")).toBeVisible();
    // A new run's claim clears the old reason (checked at the database).
    const { error: claimError } = await service()
      .from("ticket_triage_state")
      .update({ triage_status: "processing", failure_reason: null })
      .eq("ticket_id", ticket.id);
    expect(claimError).toBeNull();
    // An unknown reason can't be stored.
    const { error: badReason } = await service()
      .from("ticket_triage_state")
      .update({ failure_reason: "OpenRouter said: secret details" })
      .eq("ticket_id", ticket.id);
    expect(badReason).not.toBeNull();
  } finally {
    await service().from("tickets").delete().eq("id", ticket.id);
  }
});
