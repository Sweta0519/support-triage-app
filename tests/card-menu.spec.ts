import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-27: the queue card's quick-action menu. Tickets and their AI run are
// seeded with the service role (no model calls); each test deletes its own.

test.use({ storageState: { cookies: [], origins: [] } });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function profileId(email: string): Promise<string> {
  const { data, error } = await service().from("profiles").select("id").eq("email", email).single();
  if (error) throw new Error(error.message);
  return data.id;
}

const created: string[] = [];

// An unassigned, triaged ticket of customer A's.
async function seed(subject: string, patch: Record<string, unknown> = {}) {
  const db = service();
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: await profileId(requireEnv("TEST_USER_EMAIL")), subject, body: "Card menu probe body", ...patch })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  created.push(ticket.id);
  const ai = { priority: "normal", category: "billing", team: "billing" };
  const { error: runError } = await db
    .from("triage_results")
    .insert({ ticket_id: ticket.id, model: "test/seeded", prompt_version: "test", summary: "Seeded.", confidence: 0.9, ...ai });
  if (runError) throw new Error(runError.message);
  const { error: stateError } = await db
    .from("ticket_triage_state")
    .update({ ...ai, triage_status: "completed" })
    .eq("ticket_id", ticket.id);
  if (stateError) throw new Error(stateError.message);
  return { id: ticket.id as string, number: ticket.number as number };
}

test.afterEach(async () => {
  if (created.length) await service().from("tickets").delete().in("id", created.splice(0));
});

async function openQueueFor(page: Page, number: number) {
  await page.goto(`/queue?filter=all&q=${encodeURIComponent(`#${number}`)}`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Actions for #${number}` }) });
  await expect(card).toHaveCount(1);
  return card;
}

const menuItems = (page: Page) => page.getByRole("menu").getByRole("menuitem");

test("an agent's menu offers only what the ticket allows, and works from the keyboard", async ({ page }) => {
  const ticket = await seed(`Card menu probe ${Date.now()}`);
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const card = await openQueueFor(page, ticket.number);

  // Right-click on the card opens the menu.
  await card.getByRole("link").click({ button: "right" });
  const labels = await menuItems(page).allTextContents();
  expect(labels).toEqual(
    expect.arrayContaining(["Claim", "Move to In progress", "Flag to follow up", "Copy link"])
  );
  // Agents can't reassign; a new ticket can't jump to Resolved; and "Move to
  // Assigned" would just be Claim again.
  expect(labels.join("|")).not.toMatch(/Assign to|Unassign|Move to Resolved|Move to Closed|Move to Assigned/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // Keyboard: Shift+F10 on the focused card, arrows move, Escape returns
  // focus to the card.
  const link = card.getByRole("link");
  await link.focus();
  await page.keyboard.press("Shift+F10");
  await expect(menuItems(page).first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menuItems(page).nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(menuItems(page).last()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(link).toBeFocused();

  // A panel: Set priority… -> urgent, recorded through review_triage().
  await card.getByRole("button", { name: `Actions for #${ticket.number}` }).click();
  await page.getByRole("menuitem", { name: "Set priority…" }).click();
  await expect(page.getByRole("menuitemradio", { name: "Normal" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("menuitemradio", { name: "Urgent" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Set #${ticket.number} priority to Urgent.` })).toBeVisible();
  const { data: state } = await service().from("ticket_triage_state").select("priority, reviewed_at").eq("ticket_id", ticket.id).single();
  expect(state?.priority).toBe("urgent");
  expect(state?.reviewed_at).not.toBeNull();

  // Move to In progress claims it for the agent, as on the board.
  await card.getByRole("button", { name: `Actions for #${ticket.number}` }).click();
  await page.getByRole("menuitem", { name: "Move to In progress" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Moved #${ticket.number} to In progress.` })).toBeVisible();
  const { data: moved } = await service().from("tickets").select("status, assignee_id").eq("id", ticket.id).single();
  expect(moved).toEqual({ status: "in_progress", assignee_id: await profileId(requireEnv("TEST_AGENT_EMAIL")) });
});

test("a claim that loses the race says so", async ({ page }) => {
  const ticket = await seed(`Card race probe ${Date.now()}`);
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const card = await openQueueFor(page, ticket.number);
  await card.getByRole("button", { name: `Actions for #${ticket.number}` }).click();

  // Someone else claims it while the menu is open.
  const adminId = await profileId(requireEnv("TEST_ADMIN_EMAIL"));
  await service().from("tickets").update({ assignee_id: adminId, status: "assigned" }).eq("id", ticket.id);

  await page.getByRole("menuitem", { name: "Claim" }).click();
  await expect(page.getByRole("status").filter({ hasText: /no longer available|someone else got it first/ })).toBeVisible();
});

test("flags are private, and the Flagged tab lists them", async ({ browser }) => {
  const ticket = await seed(`Card flag probe ${Date.now()}`);
  const agentContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await agentContext.newPage();
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const card = await openQueueFor(page, ticket.number);
  await card.getByRole("button", { name: `Actions for #${ticket.number}` }).click();
  await page.getByRole("menuitem", { name: "Flag to follow up" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Flagged #${ticket.number} to follow up.` })).toBeVisible();

  await page.goto(`/queue?filter=flagged&q=${encodeURIComponent(`#${ticket.number}`)}`);
  await expect(page.getByRole("button", { name: `Actions for #${ticket.number}` })).toBeVisible();
  await agentContext.close();

  // The admin sees the ticket, but not the agent's flag.
  const adminContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const adminPage = await adminContext.newPage();
  await login(adminPage, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  await adminPage.goto(`/queue?filter=flagged&q=${encodeURIComponent(`#${ticket.number}`)}`);
  await expect(adminPage.getByRole("button", { name: `Actions for #${ticket.number}` })).toHaveCount(0);
  // And through the Data API: no rows of anyone else's.
  const admin = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await admin.auth.signInWithPassword({ email: requireEnv("TEST_ADMIN_EMAIL"), password: requireEnv("TEST_ADMIN_PASSWORD") });
  const { data: seen } = await admin.from("ticket_flags").select("user_id").eq("ticket_id", ticket.id);
  expect(seen).toEqual([]);
  await adminContext.close();
});

test("an admin can assign and unassign from the menu", async ({ page }) => {
  const ticket = await seed(`Card assign probe ${Date.now()}`);
  await login(page, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  const card = await openQueueFor(page, ticket.number);
  const actions = card.getByRole("button", { name: `Actions for #${ticket.number}` });

  await actions.click();
  await page.getByRole("menuitem", { name: "Assign to…" }).click();
  const agentId = await profileId(requireEnv("TEST_AGENT_EMAIL"));
  await page.getByRole("menu").getByRole("menuitemradio").filter({ hasText: requireEnv("TEST_AGENT_EMAIL") }).click();
  await expect(page.getByRole("status").filter({ hasText: `Assigned #${ticket.number} to` })).toBeVisible();
  expect((await service().from("tickets").select("assignee_id").eq("id", ticket.id).single()).data?.assignee_id).toBe(agentId);

  await actions.click();
  await page.getByRole("menuitem", { name: "Unassign" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Unassigned #${ticket.number}.` })).toBeVisible();
  expect((await service().from("tickets").select("assignee_id").eq("id", ticket.id).single()).data?.assignee_id).toBeNull();
});

test("a triage edit made over a newer AI run is refused, and ⋯ toggles the menu", async ({ page }) => {
  const ticket = await seed(`Card stale probe ${Date.now()}`);
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const card = await openQueueFor(page, ticket.number);
  const actions = card.getByRole("button", { name: `Actions for #${ticket.number}` });

  // Clicking ⋯ again closes the menu rather than reopening it.
  await actions.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await actions.click();
  await expect(page.getByRole("menu")).toHaveCount(0);

  // A re-run lands after the card was rendered...
  await service()
    .from("triage_results")
    .insert({ ticket_id: ticket.id, model: "test/seeded", prompt_version: "test", summary: "Newer.", confidence: 0.9, priority: "high", category: "billing", team: "billing" });

  // ...so a change made from the stale card is refused, not recorded.
  await actions.click();
  await page.getByRole("menuitem", { name: "Set team…" }).click();
  await page.getByRole("menuitemradio", { name: "Support" }).click();
  await expect(page.getByRole("status").filter({ hasText: "triage changed meanwhile" })).toBeVisible();
  const { data: state } = await service().from("ticket_triage_state").select("team, reviewed_at").eq("ticket_id", ticket.id).single();
  expect(state).toEqual({ team: "billing", reviewed_at: null });
});
