import { test, expect } from "@playwright/test";

import { login, requireEnv, selectStaffByEmail } from "./helpers";

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
  await selectStaffByEmail(adminPage, agentEmail);
  await adminPage.getByRole("button", { name: "Assign" }).click();
  // "Assigned to <display name, else email>".
  await expect(adminPage.getByText(/^Assigned to /)).toBeVisible();
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

test("admin pages: Access requests group and Admin group each show their own heading, tabs and active sidebar item", async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await login(adminPage, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));

  // Tab nav = the navigation landmark holding a tab's href. Sidebar links are
  // excluded because no tab href appears in the sidebar.
  const tabsWith = (href: string) => adminPage.getByRole("navigation").filter({ has: adminPage.locator(`a[href="${href}"]`) });
  const sidebar = adminPage.getByRole("navigation", { name: "Main" });
  const activeItem = sidebar.locator('a[aria-current="page"]');

  // Access requests group: Users and Access requests share one heading and two tabs.
  for (const path of ["/admin/users", "/admin/access-requests"]) {
    await adminPage.goto(path);
    await expect(adminPage.getByRole("heading", { level: 1, name: "Access requests" })).toBeVisible();
    await expect(tabsWith("/admin/users").getByRole("link")).toHaveText(["Users", "Access requests"]);
    await expect(activeItem).toHaveText(/^Access requests/);
  }

  // Admin group: Overview, Workload and Workspace share the "Admin" heading.
  for (const path of ["/admin", "/admin/workload", "/admin/workspace"]) {
    await adminPage.goto(path);
    await expect(adminPage.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
    await expect(tabsWith("/admin/workload").getByRole("link")).toHaveText(["Overview", "Workload", "Workspace"]);
    await expect(activeItem).toHaveText(/^Admin$/);
  }

  await adminContext.close();
});
