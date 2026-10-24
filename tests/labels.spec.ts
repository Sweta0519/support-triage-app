import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-39: team labels, Linear-style. Tickets and labels are created per
// test and deleted afterwards.

test.use({ storageState: { cookies: [], origins: [] } });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// The service role has no workspace of its own, so labels it seeds name the
// default one (where the test users are).
let defaultWorkspace: Promise<string> | undefined;
function defaultWorkspaceId() {
  defaultWorkspace ??= (async () => {
    const { data, error } = await service().from("workspaces").select("id").eq("is_default", true).single();
    if (error) throw new Error(error.message);
    return data.id as string;
  })();
  return defaultWorkspace;
}

const createdTickets: string[] = [];
const labelPrefix = `E2E ${Date.now()}`;

async function seedTicket(subject: string) {
  const db = service();
  const { data: customer } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const { data, error } = await db
    .from("tickets")
    .insert({ customer_id: customer!.id, subject, body: "Labels probe body" })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  createdTickets.push(data.id);
  return data as { id: string; number: number };
}

test.afterAll(async () => {
  const db = service();
  if (createdTickets.length) await db.from("tickets").delete().in("id", createdTickets);
  await db.from("labels").delete().like("name", `${labelPrefix}%`);
});

test("create, add and remove labels on a ticket; they show on the card", async ({ page }) => {
  const ticket = await seedTicket(`Labels probe ${Date.now()}`);
  const name = `${labelPrefix} VIP`;
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

  // Create from the ticket page's picker: it's created and applied.
  await page.goto(`/tickets/${ticket.id}`);
  const panel = page.getByRole("region", { name: "Labels" });
  await panel.getByRole("button", { name: "+ Add label" }).click();
  // The picker is portaled to <body>, outside the section.
  const picker = page.getByRole("group", { name: "Add or remove labels" });
  await picker.getByLabel("Search or create a label").fill(name);
  await picker.getByRole("button", { name: `Create “${name}”` }).click();
  await expect(panel.getByRole("button", { name: `Remove label ${name}` })).toBeVisible();

  // The queue card shows it.
  await page.goto(`/queue?filter=all&q=${encodeURIComponent(`#${ticket.number}`)}`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Actions for #${ticket.number}` }) });
  await expect(card.getByText(name, { exact: true })).toBeVisible();

  // Recorded in the ticket's history.
  const { data: events } = await service()
    .from("ticket_events")
    .select("event_type, to_value")
    .eq("ticket_id", ticket.id)
    .eq("event_type", "label_added");
  expect(events).toEqual([{ event_type: "label_added", to_value: name }]);

  // Remove it from the ticket page.
  await page.goto(`/tickets/${ticket.id}`);
  await panel.getByRole("button", { name: `Remove label ${name}` }).click();
  await expect(panel.getByRole("button", { name: `Remove label ${name}` })).toHaveCount(0);
  // The chip goes at once (optimistic); wait for the save itself before
  // leaving, or under load the queue can render before it commits.
  await expect
    .poll(async () => (await service().from("ticket_labels").select("label_id").eq("ticket_id", ticket.id)).data?.length)
    .toBe(0);
  await page.goto(`/queue?filter=all&q=${encodeURIComponent(`#${ticket.number}`)}`);
  await expect(card.getByText(name, { exact: true })).toHaveCount(0);
});

test("the card menu toggles labels; the Labels page renames and deletes them", async ({ page }) => {
  const ticket = await seedTicket(`Labels menu probe ${Date.now()}`);
  const name = `${labelPrefix} Refund`;
  const { error } = await service().from("labels").insert({ name, color: "green", workspace_id: await defaultWorkspaceId() });
  expect(error).toBeNull();
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

  await page.goto(`/queue?filter=all&q=${encodeURIComponent(`#${ticket.number}`)}`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Actions for #${ticket.number}` }) });
  await card.getByRole("button", { name: `Actions for #${ticket.number}` }).click();
  await page.getByRole("menuitem", { name: "Labels…" }).click();
  await page.getByRole("menuitemcheckbox", { name: name }).click();
  await expect(card.getByText(name, { exact: true })).toBeVisible();

  // Rename on the Labels page; the card follows.
  await page.goto("/labels");
  const renamed = `${labelPrefix} Refund request`;
  await page.getByLabel(`Name of label ${name}`).fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel(`Name of label ${renamed}`)).toBeVisible();
  await page.goto(`/queue?filter=all&q=${encodeURIComponent(`#${ticket.number}`)}`);
  await expect(card.getByText(renamed, { exact: true })).toBeVisible();

  // Delete it: gone from the ticket too.
  await page.goto("/labels");
  const row = page.getByRole("listitem").filter({ has: page.getByLabel(`Name of label ${renamed}`) });
  await row.getByRole("button", { name: "Delete", exact: true }).click();
  await row.getByRole("button", { name: `Delete “${renamed}”` }).click();
  await expect(page.getByLabel(`Name of label ${renamed}`)).toHaveCount(0);
  const { data: left } = await service().from("ticket_labels").select("label_id").eq("ticket_id", ticket.id);
  expect(left).toEqual([]);
  // The history still names it (recorded before the cascade removed it).
  const { data: removed } = await service()
    .from("ticket_events")
    .select("from_value")
    .eq("ticket_id", ticket.id)
    .eq("event_type", "label_removed");
  expect(removed).toEqual([{ from_value: renamed }]);
});

test("a labelled ticket can still be deleted (account deletion cascades to it)", async () => {
  const name = `${labelPrefix} Cascade`;
  const { data: label } = await service().from("labels").insert({ name, color: "teal", workspace_id: await defaultWorkspaceId() }).select("id").single();
  const ticket = await seedTicket(`Labels cascade probe ${Date.now()}`);
  expect((await service().from("ticket_labels").insert({ ticket_id: ticket.id, label_id: label!.id })).error).toBeNull();
  const { error } = await service().from("tickets").delete().eq("id", ticket.id);
  expect(error).toBeNull();
  expect((await service().from("tickets").select("id").eq("id", ticket.id)).data).toEqual([]);
});

test("staff can rename a label but not rewrite who created it", async () => {
  const name = `${labelPrefix} Attribution`;
  const { data: label } = await service().from("labels").insert({ name, color: "sky", workspace_id: await defaultWorkspaceId() }).select("id, created_by").single();
  const agent = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn } = await agent.auth.signInWithPassword({
    email: requireEnv("TEST_AGENT_EMAIL"),
    password: requireEnv("TEST_AGENT_PASSWORD"),
  });
  expect((await agent.from("labels").update({ created_by: signedIn.user!.id }).eq("id", label!.id)).error).not.toBeNull();
  expect((await agent.from("labels").update({ name: `${name} 2` }).eq("id", label!.id)).error).toBeNull();
  const { data: after } = await service().from("labels").select("name, created_by").eq("id", label!.id).single();
  expect(after).toEqual({ name: `${name} 2`, created_by: label!.created_by });
});

test("customers can't see or change labels", async () => {
  const name = `${labelPrefix} Internal`;
  const { data: label } = await service().from("labels").insert({ name, color: "red", workspace_id: await defaultWorkspaceId() }).select("id").single();
  const ticket = await seedTicket(`Labels rls probe ${Date.now()}`);
  await service().from("ticket_labels").insert({ ticket_id: ticket.id, label_id: label!.id });

  const customer = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await customer.auth.signInWithPassword({ email: requireEnv("TEST_USER_EMAIL"), password: requireEnv("TEST_USER_PASSWORD") });
  // Their own ticket, but labels are internal: nothing comes back.
  expect((await customer.from("labels").select("id").eq("id", label!.id)).data).toEqual([]);
  expect((await customer.from("ticket_labels").select("label_id").eq("ticket_id", ticket.id)).data).toEqual([]);
  // And they can't create, apply or remove one.
  expect((await customer.from("labels").insert({ name: `${labelPrefix} Nope`, color: "red" })).error).not.toBeNull();
  expect((await customer.from("ticket_labels").insert({ ticket_id: ticket.id, label_id: label!.id })).error).not.toBeNull();
  await customer.from("ticket_labels").delete().eq("ticket_id", ticket.id);
  expect((await service().from("ticket_labels").select("label_id").eq("ticket_id", ticket.id)).data).toHaveLength(1);
});

test("labels are edited right on the card: click them, or hover and press L (queue and board)", async ({ page }) => {
  const ticket = await seedTicket(`Labels card probe ${Date.now()}`);
  const vip = `${labelPrefix} Card VIP`;
  const refund = `${labelPrefix} Card Refund`;
  expect((await service().from("labels").insert({ name: vip, color: "violet", workspace_id: await defaultWorkspaceId() })).error).toBeNull();
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const n = `#${ticket.number}`;

  // Queue: with no labels yet, "+ Label" on the card opens the picker.
  await page.goto(`/queue?filter=all&q=${encodeURIComponent(n)}`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Actions for ${n}` }) });
  const edit = card.getByRole("button", { name: `labels for ${n}` });
  await card.hover();
  await edit.click();
  const picker = page.getByRole("group", { name: "Add or remove labels" });
  await picker.getByLabel("Search or create a label").fill(vip);
  await picker.getByRole("button", { name: vip }).click();
  await expect(picker.getByRole("button", { name: vip })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(edit).toBeFocused();
  await expect(card.getByText(vip, { exact: true })).toBeVisible();
  // The new label is a pill in the label button itself, never pushed out
  // of sight by the AI's read (SUP-41).
  await expect(card.getByRole("button", { name: new RegExp(`^${vip}: edit labels for ${n}`) })).toBeVisible();
  // Still on the queue: editing labels never opened the ticket.
  await expect(page).toHaveURL(/\/queue/);

  // Hover the card and press L; create a new label from there.
  await page.mouse.move(0, 0);
  await card.getByText(`Labels card probe`, { exact: false }).hover();
  await page.keyboard.press("l");
  // Exactly one picker, on the hovered card (focus is still on another
  // element of the page).
  await expect(picker).toHaveCount(1);
  await picker.getByLabel("Search or create a label").fill(refund);
  await picker.getByLabel("Search or create a label").press("Enter");
  await expect(picker.getByRole("button", { name: refund })).toHaveAttribute("aria-pressed", "true");
  // Escape from inside the search box closes it too.
  await picker.getByLabel("Search or create a label").press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(card.getByText(refund, { exact: true })).toBeVisible();

  // Board: click the labels to take VIP off.
  await page.goto("/board");
  const boardCard = page.getByRole("article", { name: new RegExp(`Labels card probe`) });
  await boardCard.getByRole("button", { name: `labels for ${n}` }).click();
  await picker.getByRole("button", { name: vip }).click();
  await expect(picker.getByRole("button", { name: vip })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(boardCard.getByText(vip, { exact: true })).toHaveCount(0);
  await expect(boardCard.getByText(refund, { exact: true })).toBeVisible();
});
