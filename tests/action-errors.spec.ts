import { expect, test, type Page } from "@playwright/test";

import { login, requireEnv } from "./helpers";

// SUP-75: a Server Action refused before it runs -- the Vercel firewall's
// 429 (docs/security/vercel-waf.md) or a dropped connection -- shows a
// friendly message and keeps what was typed, instead of Next's "This page
// couldn't load". The 429 is simulated: every Server Action POST (the ones
// with a Next-Action header) is answered by the "firewall" until lifted.

const FAILED = "That didn't go through: too many requests, or the connection dropped.";

async function firewall(page: Page) {
  const refuse = (route: import("@playwright/test").Route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.fulfill({ status: 429, body: "Too Many Requests" })
      : route.fallback();
  await page.route("**/*", refuse);
  return () => page.unroute("**/*", refuse);
}

test("a refused ticket and comment keep what was typed, say why, and go through on a retry", async ({ page }) => {
  const subject = `Firewall retry probe ${Date.now()}`;
  await page.goto("/tickets/new");
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Description").fill("My export keeps failing.");

  let lift = await firewall(page);
  await page.getByRole("button", { name: "Submit ticket" }).click();
  await expect(page.getByText(FAILED)).toBeVisible();
  await expect(page).toHaveURL(/\/tickets\/new$/);
  await expect(page.getByLabel("Subject")).toHaveValue(subject);
  await expect(page.getByLabel("Description")).toHaveValue("My export keeps failing.");

  await lift();
  await page.getByRole("button", { name: "Submit ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();

  // A reply: the same.
  const reply = "Here is the error message I see.";
  await page.getByPlaceholder("Write a comment...").fill(reply);
  lift = await firewall(page);
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(page.getByText(FAILED)).toBeVisible();
  await expect(page.getByPlaceholder("Write a comment...")).toHaveValue(reply);
  await lift();
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(page.getByText(reply, { exact: true })).toBeVisible();
  await expect(page.getByText(FAILED)).toHaveCount(0);
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a refused sign-in keeps the email, says why, and signs in on a retry", async ({ page }) => {
    const email = requireEnv("TEST_USER_EMAIL");
    await page.goto("/login");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(requireEnv("TEST_USER_PASSWORD"));
    const lift = await firewall(page);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(FAILED)).toBeVisible();
    await expect(page.getByPlaceholder("Email")).toHaveValue(email);
    // The password isn't kept: it's typed again.
    await expect(page.getByPlaceholder("Password")).toHaveValue("");
    await lift();
    await login(page, email, requireEnv("TEST_USER_PASSWORD"));
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  });
});

test("a refused one-click action shows a calm page with Try again, not Next's default", async ({ page }) => {
  await page.goto("/tickets");
  const lift = await firewall(page);
  // Sign out is a plain <form action> in the sidebar.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "That didn't go through" })).toBeVisible();
  await expect(page.getByText("This page couldn't load")).toHaveCount(0);
  await lift();
  await page.getByRole("button", { name: "Try again" }).click();
  // Still signed in: the refused sign-out never ran.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
});
