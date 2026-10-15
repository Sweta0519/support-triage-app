import { expect, test } from "@playwright/test";

// SUP-48: the public homepage. Signed out, / shows it (the session proxy
// rewrites / to /welcome, so the address stays /); signed in, / is the app.
const HEADLINE = "Every new ticket, read and sorted before anyone opens it.";

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/ shows the homepage, and its buttons lead to sign up and sign in", async ({ page }) => {
    await page.goto("/");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    // The hero's example ticket and the AI's suggestions for it.
    const example = page.getByRole("figure", { name: "An example ticket and the AI's suggestions for it" });
    await expect(example).toContainText("Charged twice for Pro this month");
    await expect(example).toContainText("Drafted reply, for an agent to edit and send");
    // Real product screenshots in device frames (SUP-49), and the MCP note,
    // which says plainly that it isn't available yet.
    await expect(page.getByRole("img", { name: /^The queue: tickets assigned to the agent/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /^A customer's view of their ticket on a phone/ })).toBeAttached();
    const mcp = page.getByRole("region", { name: "From your AI assistant, too" });
    await expect(mcp).toContainText("Coming soon");

    await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Request access", exact: true }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("/ with a query string, and /welcome itself, show the homepage; /privacy stays public", async ({ page }) => {
    await page.goto("/?utm_source=test");
    expect(new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    await page.goto("/welcome");
    await expect(page.getByRole("heading", { level: 1, name: HEADLINE })).toBeVisible();
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  });

  test("app pages still send signed-out visitors to sign in", async ({ page }) => {
    for (const path of ["/queue", "/tickets/new", "/account"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });
});

test("signed in, / is the app, not the homepage", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("heading", { name: HEADLINE })).toHaveCount(0);
  // Visiting the homepage directly offers the app instead of requesting access.
  await page.goto("/welcome");
  await expect(page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Open the app" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Request access", exact: true })).toHaveCount(0);
});
