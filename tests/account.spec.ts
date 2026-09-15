import { test, expect } from "@playwright/test";

import { requireEnv } from "./helpers";

// Deletion itself is not exercised here: it would destroy the shared test
// account. These cover the export, the page, and that a wrong confirmation
// is refused without touching the account.

test("account page shows the signed-in email and both data-rights actions", async ({ page }) => {
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your account", exact: true })).toBeVisible();
  // The header shows the email too; scope to the page body.
  await expect(page.getByRole("main").getByText(requireEnv("TEST_USER_EMAIL"))).toBeVisible();
  await expect(page.getByRole("link", { name: "Download my data (JSON)" })).toHaveAttribute(
    "href",
    "/account/export"
  );
  await expect(page.getByRole("button", { name: "Delete my account" })).toBeVisible();
});

test("data export is a JSON attachment scoped to the signed-in user", async ({ page }) => {
  const response = await page.request.get("/account/export");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toContain("attachment");

  const data = await response.json();
  expect(data.profile.email).toBe(requireEnv("TEST_USER_EMAIL"));
  expect(Array.isArray(data.tickets)).toBe(true);
  // Customer A is a customer: staff-only tables must come back empty, not
  // leak through the export.
  expect(data.notes).toEqual([]);
  expect(data.assistant_conversations).toEqual([]);
});

test("a wrong confirmation email does not delete the account", async ({ page }) => {
  await page.goto("/account");
  await page.getByLabel(/to confirm/).fill("someone-else@example.com");
  await page.getByRole("button", { name: "Delete my account" }).click();
  await expect(page.getByText("Type your account email exactly to confirm.")).toBeVisible();
  // Still signed in, still on the page.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});

test("anonymous export request is redirected to login", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const response = await context.request.get("/account/export", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers()["location"]).toContain("/login");
  await context.close();
});
