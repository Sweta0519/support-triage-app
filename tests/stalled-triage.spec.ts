import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { effectiveTriageStatus, STALE_TRIAGE_MS } from "../app/lib/triage-status";
import { login, requireEnv } from "./helpers";

// SUP-30: a triage run whose function died stays "pending"/"processing";
// after STALE_TRIAGE_MS it shows as stalled and can be re-run.

test.use({ storageState: { cookies: [], origins: [] } });

test("effective status: only a long-unchanged pending/processing run is stalled", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  expect(effectiveTriageStatus("processing", ago(STALE_TRIAGE_MS + 1000), now)).toBe("stalled");
  expect(effectiveTriageStatus("pending", ago(STALE_TRIAGE_MS + 1000), now)).toBe("stalled");
  expect(effectiveTriageStatus("processing", ago(60_000), now)).toBe("processing");
  expect(effectiveTriageStatus("completed", ago(STALE_TRIAGE_MS * 10), now)).toBe("completed");
  expect(effectiveTriageStatus("failed", ago(STALE_TRIAGE_MS * 10), now)).toBe("failed");
  expect(effectiveTriageStatus(undefined, undefined, now)).toBe("pending");
});

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A ticket whose triage state says "processing" since `msAgo`. updated_at
// can't be backdated by an update (a trigger sets it to now()), so the
// state row is replaced by an insert.
async function seedProcessing(subject: string, msAgo: number) {
  const db = service();
  const { data: customer } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: customer!.id, subject, body: "My invoice shows the wrong amount for September." })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  await db.from("ticket_triage_state").delete().eq("ticket_id", ticket.id);
  const { error: stateError } = await db.from("ticket_triage_state").insert({
    ticket_id: ticket.id,
    triage_status: "processing",
    updated_at: new Date(Date.now() - msAgo).toISOString(),
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
