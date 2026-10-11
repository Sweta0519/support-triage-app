import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-25: staff file a ticket on a customer's behalf. Subjects end in
// Date.now() so the suite's cleanup teardown removes them afterwards.

const dbOpts = { db: { schema: "ticketing" }, auth: { persistSession: false, autoRefreshToken: false } };

test("an agent files a ticket for a customer, who then sees it as theirs", async ({ page, browser }) => {
  const subject = `Staff filed probe ${Date.now()}`;

  const agentContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const agent = await agentContext.newPage();
  await login(agent, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await agent.getByRole("link", { name: "New ticket", exact: true }).click();
  await expect(agent.getByRole("heading", { name: "New ticket", level: 1 })).toBeVisible();
  await agent.getByLabel("Customer email").fill(requireEnv("TEST_USER_EMAIL").toUpperCase()); // case-insensitive
  await agent.getByLabel("Subject").fill(subject);
  await agent.getByLabel("Description").fill("Customer called: the export button does nothing on Safari.");
  await expect(agent.getByLabel("Assign to me")).toBeChecked();
  await agent.getByRole("button", { name: "Create ticket" }).click();

  await expect(agent.getByRole("heading", { name: subject })).toBeVisible();
  await expect(agent.getByText("Filed by you on the customer's behalf")).toBeVisible();
  await expect(agent.getByText("Assigned to you")).toBeVisible();
  await agentContext.close();

  // Customer A (default storageState) owns it.
  await page.goto("/tickets");
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await expect(page.getByText("Filed by our support team on your behalf")).toBeVisible();
});

test("only existing customer accounts can be filed for", async ({ browser }) => {
  const agentContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const agent = await agentContext.newPage();
  await login(agent, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

  // An unknown address and a staff address get the same answer.
  for (const email of [`nobody-${Date.now()}@example.com`, requireEnv("TEST_ADMIN_EMAIL")]) {
    await agent.goto("/tickets/new");
    await agent.getByLabel("Customer email").fill(email);
    await agent.getByLabel("Subject").fill(`Unknown customer probe ${Date.now()}`);
    await agent.getByLabel("Description").fill("Should not be created.");
    await agent.getByRole("button", { name: "Create ticket" }).click();
    await expect(
      agent.getByRole("alert").filter({ hasText: "No customer account with that email." })
    ).toBeVisible();
  }
  await agentContext.close();
});

test("customers can't use the staff path or set who filed a ticket", async ({ page }) => {
  // The customer's own form has no customer-email field.
  await page.goto("/tickets/new");
  await expect(page.getByLabel("Customer email")).toHaveCount(0);

  const customer = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), dbOpts);
  const { data: signIn } = await customer.auth.signInWithPassword({
    email: requireEnv("TEST_USER_EMAIL"),
    password: requireEnv("TEST_USER_PASSWORD"),
  });

  const rpc = await customer.rpc("staff_create_ticket", {
    p_customer_email: requireEnv("TEST_USER_B_EMAIL"),
    p_subject: `RPC probe ${Date.now()}`,
    p_body: "x",
    p_assign_to_me: false,
  });
  expect(rpc.error?.message).toContain("not_allowed");

  // created_by isn't in the customer's INSERT column grant.
  const forged = await customer.from("tickets").insert({
    customer_id: signIn.user!.id,
    subject: `Forged filer probe ${Date.now()}`,
    body: "x",
    created_by: signIn.user!.id,
  });
  expect(forged.error?.message).toContain("permission denied");
});
