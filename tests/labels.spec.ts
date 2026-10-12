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

test("create, add and remove labels on a ticket; they show first on the card", async ({ page }) => {
  const ticket = await seedTicket(`Labels probe ${Date.now()}`);
  const name = `${labelPrefix} VIP`;
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

  // Create from the ticket page's picker: it's created and applied.
  await page.goto(`/tickets/${ticket.id}`);
  const panel = page.getByRole("region", { name: "Labels" });
  await panel.getByRole("button", { name: "+ Add label" }).click();
  await panel.getByLabel("Search or create a label").fill(name);
  await panel.getByRole("button", { name: `Create “${name}”` }).click();
  await expect(panel.getByRole("button", { name: `Remove label ${name}` })).toBeVisible();

  // The queue card leads with it.
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
  await page.goto(`/queue?filter=all&q=${encodeURIComponent(`#${ticket.number}`)}`);
  await expect(card.getByText(name, { exact: true })).toHaveCount(0);
});

test("the card menu toggles labels; the Labels page renames and deletes them", async ({ page }) => {
  const ticket = await seedTicket(`Labels menu probe ${Date.now()}`);
  const name = `${labelPrefix} Refund`;
  const { error } = await service().from("labels").insert({ name, color: "green" });
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
});

test("customers can't see or change labels", async () => {
  const name = `${labelPrefix} Internal`;
  const { data: label } = await service().from("labels").insert({ name, color: "red" }).select("id").single();
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
