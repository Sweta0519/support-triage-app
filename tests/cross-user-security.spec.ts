import { test, expect, type Page } from "@playwright/test";

// This test manages its own two identities, so it opts out of the
// 'chromium' project's default storageState (customer A, already signed in).
test.use({ storageState: { cookies: [], origins: [] } });

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test("customer B cannot open customer A's ticket via direct URL", async ({
  browser,
}) => {
  const emailA = process.env.TEST_USER_EMAIL;
  const passwordA = process.env.TEST_USER_PASSWORD;
  const emailB = process.env.TEST_USER_B_EMAIL;
  const passwordB = process.env.TEST_USER_B_PASSWORD;
  if (!emailA || !passwordA || !emailB || !passwordB) {
    throw new Error(
      "TEST_USER_EMAIL/PASSWORD and TEST_USER_B_EMAIL/PASSWORD must all be set in .env.local."
    );
  }

  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await login(pageA, emailA, passwordA);

  const subject = `Cross-user security probe ${Date.now()}`;
  await pageA.goto("/tickets/new");
  await pageA.getByPlaceholder("Subject").fill(subject);
  await pageA
    .getByPlaceholder("Describe what's going on...")
    .fill("This ticket must never be visible to another customer.");
  await pageA.getByRole("button", { name: "Submit ticket" }).click();
  await expect(pageA.getByRole("heading", { name: subject })).toBeVisible();

  const ticketUrl = pageA.url();
  const ticketId = new URL(ticketUrl).pathname.split("/").pop();
  expect(ticketId).toBeTruthy();
  await contextA.close();

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await login(pageB, emailB, passwordB);

  // Customer B is signed in (a real, different account) and goes straight
  // to customer A's ticket by URL. This must 404 -- not show the ticket,
  // and not merely bounce to /login (which would just mean "not signed in",
  // not "blocked from someone else's data").
  const response = await pageB.goto(`/tickets/${ticketId}`);
  expect(response?.status()).toBe(404);
  await expect(pageB.getByText(subject)).not.toBeVisible();

  await contextB.close();
});
