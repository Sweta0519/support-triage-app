import { test as setup, expect } from "@playwright/test";

const authFile = "playwright/.auth/customerA.json";

setup("authenticate as customer A", async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Set TEST_USER_EMAIL and TEST_USER_PASSWORD in .env.local to a dedicated test account before running the Playwright suite."
    );
  }

  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // "Sign out" only renders once signed in -- unambiguous post-login marker.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await page.context().storageState({ path: authFile });
});
