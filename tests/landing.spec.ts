import { expect, test } from "@playwright/test";

import { login, requireEnv } from "./helpers";

// SUP-48: the public homepage. Signed out, / shows it (the session proxy
// rewrites / to /welcome, so the address stays /); signed in, / is the app.
const HEADLINE = "Every new ticket, read and sorted before anyone opens it.";

test.describe("signed out", () => {
  // Wide enough for the inline header links (xl and up).
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 900 } });

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
    // Loaded, not just present: a 404 would still be "visible" (lazy images
    // load once scrolled into view).
    for (const name of [/^The queue: tickets assigned to the agent/, /^A customer's view of their ticket on a phone/, /^An incident:/, /^Analytics:/]) {
      const img = page.getByRole("img", { name });
      await img.scrollIntoViewIfNeeded();
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    }
    const mcp = page.getByRole("region", { name: "From your AI assistant, too" });
    await expect(mcp).toContainText("Coming soon");
    // Every header link points at a section on the page.
    for (const href of await page.getByRole("navigation", { name: "Page" }).getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
      await expect(page.locator(href!)).toHaveCount(1);
    }
    // Pricing (SUP-51): Free and Custom; Custom's "Contact us" goes through
    // Support Triage itself (sign up, then a ticket).
    await page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Pricing", exact: true }).click();
    await expect(page).toHaveURL(/#pricing$/);
    const pricing = page.getByRole("region", { name: "Pricing" });
    await expect(pricing.getByRole("heading", { name: "Free" })).toBeVisible();
    await expect(pricing.getByRole("heading", { name: "Custom" })).toBeVisible();
    await expect(pricing.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/signup");

    await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Request access", exact: true }).click();
    await expect(page).toHaveURL(/\/signup$/);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the demo video is reachable from the hero, captioned, and served to signed-out visitors", async ({ page }) => {
    // SUP-50: not downloaded until played; captions on by default.
    await page.goto("/");
    await page.getByRole("link", { name: "Watch the 2-minute demo" }).click();
    await expect(page).toHaveURL(/#demo$/);
    const video = page.locator("#demo video");
    await expect(video).toHaveAttribute("preload", "none");
    const track = video.locator("track[kind=captions]");
    await expect(track).toHaveAttribute("src", "/marketing/demo.vtt");
    await expect(track).toHaveAttribute("default", "");
    const mp4 = await page.request.head("/marketing/demo.mp4");
    expect(mp4.ok()).toBe(true);
    expect(mp4.headers()["content-type"]).toContain("video/mp4");
    expect(await (await page.request.get("/marketing/demo.vtt")).text()).toMatch(/^WEBVTT/);
    expect((await page.request.get("/marketing/demo-poster.webp")).ok()).toBe(true);
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
  // A signed-in customer's "Contact us" opens a new ticket straight away.
  await expect(page.getByRole("region", { name: "Pricing" }).getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/tickets/new");
});

test.describe("signed out, on a phone", () => {
  test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 } });

  test("the header menu lists the sections and Sign in, and closes on a pick, Escape or a click outside", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Page", exact: true });
    const menu = nav.locator("details");
    const button = nav.getByText("Menu", { exact: true });
    await button.click();
    await expect(menu).toHaveAttribute("open", "");
    await expect(nav.getByRole("link", { name: "Sign in" })).toBeVisible();
    // Picking a section jumps there and closes the menu.
    await nav.getByRole("link", { name: "Pricing", exact: true }).click();
    await expect(page).toHaveURL(/#pricing$/);
    await expect(menu).not.toHaveAttribute("open", "");
    // Escape closes it and puts focus back on the button.
    await button.click();
    await page.keyboard.press("Escape");
    await expect(menu).not.toHaveAttribute("open", "");
    await expect(button).toBeFocused();
    // So does a click anywhere else.
    await button.click();
    await page.getByRole("heading", { level: 2, name: "Pricing" }).click();
    await expect(menu).not.toHaveAttribute("open", "");
  });
});

test("signed-in staff see no Contact us: they're the team it would reach", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.goto("/welcome");
  const pricing = page.getByRole("region", { name: "Pricing" });
  await expect(pricing).toContainText("You're on the team");
  await expect(pricing.getByRole("link", { name: "Contact us" })).toHaveCount(0);
  await context.close();
});
