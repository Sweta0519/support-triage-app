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

test("non-admins are bounced from /admin to /403", async ({ page, browser }) => {
  // Customer A (default storageState).
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/403$/);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/403$/);

  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await login(agentPage, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await agentPage.goto("/admin");
  await expect(agentPage).toHaveURL(/\/403$/);
  await agentContext.close();
});

test("admin sees the overview, can change another user's role, and cannot change their own", async ({
  browser,
}) => {
  const adminEmail = requireEnv("TEST_ADMIN_EMAIL");
  const flipEmail = requireEnv("TEST_ROLEFLIP_EMAIL");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, adminEmail, requireEnv("TEST_ADMIN_PASSWORD"));

  await adminPage.goto("/admin");
  await expect(adminPage.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(adminPage.getByText("Tickets", { exact: true })).toBeVisible();
  await expect(adminPage.getByText("AI triage", { exact: true })).toBeVisible();

  await adminPage.goto("/admin/users");
  const ownRow = adminPage.getByRole("row", { name: new RegExp(adminEmail) });
  await expect(ownRow.getByText("(you)")).toBeVisible();
  await expect(ownRow.getByRole("combobox")).toBeDisabled();
  await expect(ownRow.getByRole("button", { name: "Save" })).toBeDisabled();

  // Promote the throwaway user to agent, then put them back. If this test
  // dies midway nothing else depends on that account's role.
  const flipRow = adminPage.getByRole("row", { name: new RegExp(flipEmail) });
  await expect(flipRow.getByRole("cell", { name: "customer", exact: true })).toBeVisible();
  await flipRow.getByRole("combobox").selectOption("agent");
  await flipRow.getByRole("button", { name: "Save" }).click();
  await expect(adminPage.getByText("Role updated.")).toBeVisible();
  await expect(
    adminPage.getByRole("row", { name: new RegExp(flipEmail) }).getByRole("cell", { name: "agent", exact: true })
  ).toBeVisible();

  const flipRowAgain = adminPage.getByRole("row", { name: new RegExp(flipEmail) });
  await flipRowAgain.getByRole("combobox").selectOption("customer");
  await flipRowAgain.getByRole("button", { name: "Save" }).click();
  await expect(adminPage.getByText("Role updated.")).toBeVisible();
  await expect(
    adminPage.getByRole("row", { name: new RegExp(flipEmail) }).getByRole("cell", { name: "customer", exact: true })
  ).toBeVisible();

  await adminContext.close();
});

test("admin can reassign a ticket to an agent, who then sees it as theirs", async ({
  page,
  browser,
}) => {
  const agentEmail = requireEnv("TEST_AGENT_EMAIL");

  // Customer A creates the ticket.
  const subject = `Reassignment probe ${Date.now()}`;
  await page.goto("/tickets/new");
  await page.getByPlaceholder("Subject").fill(subject);
  await page.getByPlaceholder("Describe what's going on...").fill("Please route this to someone.");
  await page.getByRole("button", { name: "Submit ticket" }).click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  const ticketUrl = page.url();

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  await adminPage.goto(ticketUrl);
  // "Unassigned" is also an <option> in the Reassign dropdown; target the status line.
  await expect(adminPage.locator("p", { hasText: /^Unassigned$/ })).toBeVisible();
  await adminPage.getByLabel("Reassign").selectOption({ label: `${agentEmail} (agent)` });
  await adminPage.getByRole("button", { name: "Assign" }).click();
  await expect(adminPage.getByText(`Assigned to ${agentEmail}`)).toBeVisible();
  await adminContext.close();

  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await login(agentPage, agentEmail, requireEnv("TEST_AGENT_PASSWORD"));
  await agentPage.goto(ticketUrl);
  await expect(agentPage.getByText("Assigned to you")).toBeVisible();
  // Agents never get the reassignment control.
  await expect(agentPage.getByLabel("Reassign")).not.toBeVisible();
  await agentContext.close();
});
