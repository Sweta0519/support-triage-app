import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// Staff review of AI triage. The AI run is seeded straight into the
// database with the service-role key rather than produced by OpenRouter, so
// these tests are free, fast and deterministic: what's under test is the
// review path (RPC, events, re-run protection), not the model.

test.use({ storageState: { cookies: [], origins: [] } });

function serviceClient() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type SupabaseClient = ReturnType<typeof serviceClient>;

async function profileId(db: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await db.from("profiles").select("id").eq("email", email).single();
  if (error) throw new Error(error.message);
  return data.id;
}

type AiFields = { priority: string; category: string; team: string };

async function insertAiRun(db: SupabaseClient, ticketId: string, ai: AiFields): Promise<string> {
  const { data, error } = await db
    .from("triage_results")
    .insert({
      ticket_id: ticketId,
      model: "test/seeded",
      prompt_version: "test",
      summary: "Seeded assessment for the review test.",
      confidence: 0.9,
      ...ai,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id;
}

// An unassigned ticket filed by customer A, with one seeded AI run applied
// to its working state exactly as the pipeline would.
async function seedTriagedTicket(db: SupabaseClient, subject: string, ai: AiFields) {
  const customerId = await profileId(db, requireEnv("TEST_USER_EMAIL"));
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: customerId, subject, body: "My invoice shows the wrong amount." })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const resultId = await insertAiRun(db, ticket.id, ai);
  const { error: stateError } = await db
    .from("ticket_triage_state")
    .update({ ...ai, triage_status: "completed" })
    .eq("ticket_id", ticket.id);
  if (stateError) throw new Error(stateError.message);

  return { ticketId: ticket.id as string, resultId };
}

const AI: AiFields = { priority: "high", category: "billing", team: "billing" };

test("staff confirm the AI's triage, then correct it, and both are recorded", async ({ page }) => {
  const db = serviceClient();
  const subject = `Review probe ${Date.now()}`;
  const { ticketId } = await seedTriagedTicket(db, subject, AI);

  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.goto(`/tickets/${ticketId}`);
  const panel = page.locator("section").filter({ hasText: "AI triage" });

  await expect(panel.getByText("Not reviewed yet", { exact: false })).toBeVisible();
  await panel.getByRole("button", { name: "Confirm AI triage" }).click();
  await expect(panel.getByRole("status")).toHaveText("Confirmed the AI's triage.");
  await expect(panel.getByText("Reviewed by you", { exact: false })).toBeVisible();

  // Correct the priority: the button switches to "Save correction" and the
  // AI's original value is shown next to the changed field.
  await panel.getByLabel("Priority").selectOption("low");
  await expect(panel.getByText("AI: high")).toBeVisible();
  await panel.getByRole("button", { name: "Save correction" }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved your triage.");
  // The dropdown keeps the saved value after the action (no form reset).
  await expect(panel.getByLabel("Priority")).toHaveValue("low");

  const { data: state } = await db
    .from("ticket_triage_state")
    .select("priority, category, team, reviewed_at, reviewed_by")
    .eq("ticket_id", ticketId)
    .single();
  expect(state).toMatchObject({ priority: "low", category: "billing", team: "billing" });
  expect(state?.reviewed_at).toBeTruthy();
  expect(state?.reviewed_by).toBe(await profileId(db, requireEnv("TEST_AGENT_EMAIL")));

  const { data: events } = await db
    .from("ticket_events")
    .select("event_type, from_value, to_value")
    .eq("ticket_id", ticketId)
    .in("event_type", ["triage_reviewed", "priority_changed"])
    .order("created_at", { ascending: true });
  expect(events).toEqual([
    { event_type: "triage_reviewed", from_value: null, to_value: "confirmed" },
    { event_type: "priority_changed", from_value: "high", to_value: "low" },
    { event_type: "triage_reviewed", from_value: null, to_value: "corrected" },
  ]);

  // The queue sorts and badges by the human value now.
  await page.goto("/queue?filter=unassigned");
  const row = page.getByRole("link", { name: new RegExp(subject) });
  await expect(row.getByText("low", { exact: true })).toBeVisible();
});

test("a review against a superseded AI run is rejected, and a re-run never overwrites a review", async ({
  page,
}) => {
  const db = serviceClient();
  const { ticketId } = await seedTriagedTicket(db, `Stale review probe ${Date.now()}`, AI);

  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.goto(`/tickets/${ticketId}`);
  const panel = page.locator("section").filter({ hasText: "AI triage" });
  await expect(panel.getByRole("button", { name: "Confirm AI triage" })).toBeVisible();

  // A new AI run lands while the agent has the page open, and the pipeline
  // applies it to the (still unreviewed) working state.
  await insertAiRun(db, ticketId, { priority: "urgent", category: "billing", team: "billing" });
  const { error: applyError } = await db
    .from("ticket_triage_state")
    .update({ priority: "urgent" })
    .eq("ticket_id", ticketId);
  if (applyError) throw new Error(applyError.message);

  await panel.getByRole("button", { name: "Confirm AI triage" }).click();
  await expect(panel.getByRole("alert")).toContainText("The AI assessment changed");
  // The form now shows the new run's values, not the old selection that was
  // refused, so confirming again can't write the superseded priority back.
  await expect(panel.getByLabel("Priority")).toHaveValue("urgent");
  await expect(panel.getByRole("button", { name: "Confirm AI triage" })).toBeVisible();

  // Reviewing the current run works.
  await page.reload();
  await panel.getByLabel("Priority").selectOption("normal");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved your triage.");

  // Same update the pipeline's applyTriageToTicket() makes: it must not
  // touch a reviewed row's fields.
  await insertAiRun(db, ticketId, { priority: "low", category: "general", team: "support" });
  const { data: updated } = await db
    .from("ticket_triage_state")
    .update({ priority: "low", category: "general", team: "support", triage_status: "completed" })
    .eq("ticket_id", ticketId)
    .is("reviewed_at", null)
    .select("ticket_id");
  expect(updated).toEqual([]);

  await page.reload();
  await expect(panel.getByText("The AI has re-assessed since", { exact: false })).toBeVisible();
  await expect(panel.getByLabel("Priority")).toHaveValue("normal");
});

test("a review saved from a page loaded before someone else's review is rejected", async ({ page }) => {
  const db = serviceClient();
  const { ticketId } = await seedTriagedTicket(db, `Concurrent review probe ${Date.now()}`, AI);

  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.goto(`/tickets/${ticketId}`);
  const panel = page.locator("section").filter({ hasText: "AI triage" });
  await expect(panel.getByRole("button", { name: "Confirm AI triage" })).toBeVisible();

  // An admin corrects the priority while the agent has the page open.
  const { error: reviewError } = await db
    .from("ticket_triage_state")
    .update({
      priority: "low",
      reviewed_by: await profileId(db, requireEnv("TEST_ADMIN_EMAIL")),
      reviewed_at: new Date().toISOString(),
    })
    .eq("ticket_id", ticketId);
  if (reviewError) throw new Error(reviewError.message);

  // Confirming from the old page must not put "high" back.
  await panel.getByRole("button", { name: "Confirm AI triage" }).click();
  await expect(panel.getByRole("alert")).toContainText("Someone else reviewed this ticket");
  await expect(panel.getByLabel("Priority")).toHaveValue("low");

  const { data: state } = await db
    .from("ticket_triage_state")
    .select("priority")
    .eq("ticket_id", ticketId)
    .single();
  expect(state).toEqual({ priority: "low" });

  // Saving again from the refreshed form works.
  await panel.getByLabel("Priority").selectOption("normal");
  await panel.getByRole("button", { name: "Save correction" }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved your triage.");
});

test("customers cannot call review_triage directly", async () => {
  const db = serviceClient();
  const { ticketId, resultId } = await seedTriagedTicket(db, `Customer RPC probe ${Date.now()}`, AI);

  // Customer A owns this ticket and can see it -- and still must not be able
  // to set its triage fields through the Data API.
  const customer = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { db: { schema: "ticketing" }, auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { error: signInError } = await customer.auth.signInWithPassword({
    email: requireEnv("TEST_USER_EMAIL"),
    password: requireEnv("TEST_USER_PASSWORD"),
  });
  expect(signInError).toBeNull();

  const { error } = await customer.rpc("review_triage", {
    p_ticket_id: ticketId,
    p_result_id: resultId,
    p_priority: "urgent",
    p_category: "billing",
    p_team: "billing",
    p_reviewed_at: null,
  });
  expect(error?.message).toContain("not_allowed");

  const { data: state } = await db
    .from("ticket_triage_state")
    .select("priority, reviewed_at")
    .eq("ticket_id", ticketId)
    .single();
  expect(state).toEqual({ priority: "high", reviewed_at: null });
});
