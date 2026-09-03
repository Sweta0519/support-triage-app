import { test, expect } from "@playwright/test";

test("customer can create a ticket and see it in their list and detail view", async ({
  page,
}) => {
  const subject = `Test ticket ${Date.now()}`;
  const body = "Something is broken, please help.";

  await page.goto("/tickets/new");
  await page.getByPlaceholder("Subject").fill(subject);
  await page.getByPlaceholder("Describe what's going on...").fill(body);
  await page.getByRole("button", { name: "Submit ticket" }).click();

  // Redirects to the new ticket's detail page.
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  await expect(page.getByText(body)).toBeVisible();

  await page.goto("/tickets");
  await expect(page.getByRole("link", { name: subject })).toBeVisible();
});
