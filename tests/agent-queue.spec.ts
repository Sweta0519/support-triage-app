import { test, expect } from "@playwright/test";

import { login } from "./helpers";

test("agent can claim a ticket, move its status, and post an internal note the customer never sees", async ({
  page,
  browser,
}) => {
  const agentEmail = process.env.TEST_AGENT_EMAIL;
  const agentPassword = process.env.TEST_AGENT_PASSWORD;
  if (!agentEmail || !agentPassword) {
    throw new Error("Set TEST_AGENT_EMAIL and TEST_AGENT_PASSWORD in .env.local.");
  }

  // `page` uses the default storageState -- already signed in as customer A.
  const subject = `Agent queue probe ${Date.now()}`;
  await page.goto("/tickets/new");
  await page.getByPlaceholder("Subject").fill(subject);
  await page
    .getByPlaceholder("Describe what's going on...")
    .fill("Needs an agent's attention.");
  await page.getByRole("button", { name: "Submit ticket" }).click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  const ticketUrl = page.url();

  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await login(agentPage, agentEmail, agentPassword);

  await agentPage.goto("/queue");
  const queueRow = agentPage.getByRole("link", { name: new RegExp(subject) });
  await expect(queueRow).toBeVisible();
  await expect(queueRow.getByText("Unassigned")).toBeVisible();

  await queueRow.click();
  await expect(agentPage.getByRole("heading", { name: subject })).toBeVisible();
  await agentPage.getByRole("button", { name: "Claim ticket" }).click();
  await expect(agentPage.getByText("Assigned to you")).toBeVisible();

  await agentPage.getByRole("button", { name: "Move to In progress" }).click();
  await expect(agentPage.locator("span", { hasText: "in_progress" }).first()).toBeVisible();

  const noteText = `Internal note ${Date.now()}: checking logs.`;
  await agentPage.getByPlaceholder("Write a comment...").fill(noteText);
  await agentPage.getByLabel("Internal note (not visible to the customer)").check();
  await agentPage.getByRole("button", { name: "Add comment" }).click();
  await expect(agentPage.getByText(noteText)).toBeVisible();
  await expect(agentPage.getByText("Internal note", { exact: true })).toBeVisible();

  await agentContext.close();

  await page.goto(ticketUrl);
  await expect(page.getByText(noteText)).not.toBeVisible();
});
