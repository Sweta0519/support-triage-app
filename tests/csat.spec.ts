import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-26: customers rate resolved tickets (CSAT); admins see it per staff
// member on Analytics. Tickets are seeded with the service role and their
// subjects end in Date.now() so the suite's teardown removes them.

const opts = { db: { schema: "ticketing" }, auth: { persistSession: false, autoRefreshToken: false } };
const service = () => createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), opts);
async function signedIn(email: string, password: string) {
  const client = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), opts);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return { client, id: data.user!.id };
}

// Every ticket a test seeds is deleted after it (ratings cascade), so rated
// probes don't linger in the live analytics until the next run's sweep.
const seeded: string[] = [];
test.afterEach(async () => {
  if (seeded.length) await service().from("tickets").delete().in("id", seeded.splice(0));
});

// A ticket for customer A, assigned and then resolved the way the app
// would move it (the guard trigger only allows step-by-step transitions).
async function resolvedTicket(db: ReturnType<typeof service>, assigneeId: string, label: string) {
  const { data: customer } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const { data: t, error } = await db
    .from("tickets")
    .insert({ customer_id: customer!.id, subject: `${label} ${Date.now()}`, body: "CSAT probe." })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  seeded.push(t.id);
  for (const patch of [{ assignee_id: assigneeId, status: "assigned" }, { status: "in_progress" }, { status: "resolved" }]) {
    const { error: e } = await db.from("tickets").update(patch).eq("id", t.id);
    if (e) throw new Error(e.message);
  }
  return t as { id: string; number: number };
}

test("a customer rates their resolved ticket, crediting the agent who handled it", async ({ page }) => {
  const db = service();
  const agent = await signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const admin = await signedIn(requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  const ticket = await resolvedTicket(db, agent.id, "CSAT probe");

  // Customer A (default storageState) rates it on the ticket page.
  await page.goto(`/tickets/${ticket.id}`);
  await expect(page.getByRole("heading", { name: "How did we do?" })).toBeVisible();
  await page.getByLabel("4 stars: Good").check({ force: true });
  await page.getByLabel("Comment (optional)").fill("Quick and friendly.");
  await page.getByRole("button", { name: "Send rating" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Thanks for your feedback." })).toBeVisible();

  const stored = async () =>
    (await db.from("ticket_ratings").select("score, comment, agent_id").eq("ticket_id", ticket.id).single()).data;
  expect(await stored()).toEqual({ score: 4, comment: "Quick and friendly.", agent_id: agent.id });

  // Reassigned afterwards: changing the rating keeps the original credit.
  await db.from("tickets").update({ assignee_id: admin.id }).eq("id", ticket.id);
  await page.reload();
  await page.getByLabel("2 stars: Poor").check({ force: true });
  await page.getByRole("button", { name: "Update rating" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Thanks for your feedback." })).toBeVisible();
  expect(await stored()).toMatchObject({ score: 2, agent_id: agent.id });

  // The credited agent can read it; it shows on the admin's analytics.
  const { data: agentView } = await agent.client.from("ticket_ratings").select("score").eq("ticket_id", ticket.id);
  expect(agentView).toEqual([{ score: 2 }]);

  // Once closed it's read-only.
  await db.from("tickets").update({ status: "closed" }).eq("id", ticket.id);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your rating" })).toBeVisible();
  await expect(page.getByRole("button", { name: /rating/ })).toHaveCount(0);
  const locked = await (await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"))).client.rpc(
    "rate_ticket",
    { p_ticket_id: ticket.id, p_score: 5, p_comment: "" }
  );
  expect(locked.error?.message).toBe("not_resolved");
});

test("only the ticket's customer can rate, and agents only see their own ratings", async () => {
  const db = service();
  const customer = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
  const customerB = await signedIn(requireEnv("TEST_USER_B_EMAIL"), requireEnv("TEST_USER_B_PASSWORD"));
  const agent = await signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const admin = await signedIn(requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  const adminsTicket = await resolvedTicket(db, admin.id, "CSAT access probe");
  const rate = (c: typeof customer, score = 3) =>
    c.client.rpc("rate_ticket", { p_ticket_id: adminsTicket.id, p_score: score, p_comment: "" });

  expect((await rate(customerB)).error?.message).toBe("not_found"); // someone else's ticket
  expect((await rate(agent)).error?.message).toBe("not_found"); // staff can't rate
  expect((await rate(customer, 9)).error?.message).toBe("invalid_score");
  expect((await rate(customer)).error).toBeNull();

  // Credited to the admin: the agent can't read it, the admin can.
  expect((await agent.client.from("ticket_ratings").select("score").eq("ticket_id", adminsTicket.id)).data).toEqual([]);
  expect((await admin.client.from("ticket_ratings").select("score").eq("ticket_id", adminsTicket.id)).data).toEqual([
    { score: 3 },
  ]);

  // No direct writes: the table is read-only for clients.
  const direct = await customer.client
    .from("ticket_ratings")
    .update({ score: 5 })
    .eq("ticket_id", adminsTicket.id)
    .select("score");
  expect(direct.error?.message ?? (direct.data?.length === 0 ? "no rows" : "updated")).not.toBe("updated");

  // An open ticket can't be rated.
  const { data: openOne } = await db
    .from("tickets")
    .insert({ customer_id: customer.id, subject: `CSAT open probe ${Date.now()}`, body: "x" })
    .select("id")
    .single();
  seeded.push(openOne!.id);
  const notYet = await customer.client.rpc("rate_ticket", { p_ticket_id: openOne!.id, p_score: 5, p_comment: "" });
  expect(notYet.error?.message).toBe("not_resolved");
});

test("admins see team CSAT and low ratings on Analytics", async ({ browser }) => {
  const db = service();
  const agent = await signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const ticket = await resolvedTicket(db, agent.id, "CSAT low probe");
  const customer = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
  await customer.client.rpc("rate_ticket", { p_ticket_id: ticket.id, p_score: 1, p_comment: "Nobody called me back." });

  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await login(page, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Team performance" })).toBeVisible();
  await expect(page.getByText("Customer satisfaction", { exact: true })).toBeVisible();
  const low = page.locator("section", { has: page.getByRole("heading", { name: "Recent low ratings" }) });
  await expect(low.getByRole("link", { name: new RegExp(`#${ticket.number} `) })).toBeVisible();
  await expect(low.getByText("Nobody called me back.")).toBeVisible();
  await ctx.close();
});

test("a rating given after the ticket is reopened and resolved again credits the new resolver", async () => {
  const db = service();
  const customer = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
  const agent = await signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const admin = await signedIn(requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  const ticket = await resolvedTicket(db, agent.id, "CSAT reopen probe");
  const rate = (score: number) => customer.client.rpc("rate_ticket", { p_ticket_id: ticket.id, p_score: score, p_comment: "" });
  const credit = async () =>
    (await db.from("ticket_ratings").select("agent_id").eq("ticket_id", ticket.id).single()).data?.agent_id;

  expect((await rate(5)).error).toBeNull();
  expect(await credit()).toBe(agent.id);

  // Reopened, taken over by the admin and resolved again.
  for (const patch of [{ status: "in_progress" }, { assignee_id: admin.id }, { status: "resolved" }]) {
    const { error } = await db.from("tickets").update(patch).eq("id", ticket.id);
    if (error) throw new Error(error.message);
  }
  expect((await rate(2)).error).toBeNull();
  expect(await credit()).toBe(admin.id);
});
