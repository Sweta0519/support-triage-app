import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in .env.local.`);
  }
  return value;
}

// Direct-URL checks for every role boundary not already covered by the
// feature tests: customer -> staff routes, and agent -> a ticket owned by
// another staff member.

test("a customer is bounced from the staff queue", async ({ page }) => {
  await page.goto("/queue");
  await expect(page).toHaveURL(/\/403$/);
});

test("an agent gets a 404 for a ticket assigned to someone else", async ({
  page,
  browser,
}) => {
  const adminEmail = requireEnv("TEST_ADMIN_EMAIL");

  // Customer A files the ticket.
  const subject = `Visibility probe ${Date.now()}`;
  await page.goto("/tickets/new");
  await page.getByPlaceholder("Subject").fill(subject);
  await page.getByPlaceholder("Describe what's going on...").fill("Who can see this?");
  await page.getByRole("button", { name: "Submit ticket" }).click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  const ticketUrl = page.url();

  // Admin assigns it to themselves.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, adminEmail, requireEnv("TEST_ADMIN_PASSWORD"));
  await adminPage.goto(ticketUrl);
  await adminPage.getByLabel("Reassign").selectOption({ label: `${adminEmail} (admin)` });
  await adminPage.getByRole("button", { name: "Assign" }).click();
  await expect(adminPage.getByText("Assigned to you")).toBeVisible();
  await adminContext.close();

  // The agent can see unassigned tickets and their own -- not this one.
  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await login(agentPage, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  const response = await agentPage.goto(ticketUrl);
  expect(response?.status()).toBe(404);
  await expect(agentPage.getByText(subject)).not.toBeVisible();
  // ...and it isn't in their queue either.
  await agentPage.goto("/queue");
  await expect(agentPage.getByRole("link", { name: new RegExp(subject) })).not.toBeVisible();
  await agentContext.close();

  // The customer who filed it still sees it.
  await page.goto(ticketUrl);
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
});
