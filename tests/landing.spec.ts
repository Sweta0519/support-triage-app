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
    // Loaded, not just present: a 404 would still be "visible" (lazy images
    // load once scrolled into view).
    for (const name of [/^The queue: tickets assigned to the agent/, /^A customer's view of their ticket on a phone/, /^An incident:/, /^Analytics:/]) {
      // Each screenshot is a button that enlarges it (SUP-62).
      const shot = page.getByRole("button", { name: new RegExp(`^Enlarge: ${name.source.slice(1)}`) });
      const img = shot.locator("img");
      await img.scrollIntoViewIfNeeded();
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    }
    // Enlarging opens the full image in a dialog; Escape closes it and focus
    // goes back to the screenshot.
    const queueShot = page.getByRole("button", { name: /^Enlarge: The queue/ });
    await queueShot.click();
    const lightbox = page.getByRole("dialog", { name: /^The queue/ });
    await expect(lightbox).toBeVisible();
    await expect.poll(() => lightbox.locator("img").evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth >= 2400)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();
    await expect(queueShot).toBeFocused();
    const mcp = page.getByRole("region", { name: "From your AI assistant, too" });
    await expect(mcp).toContainText("Coming soon");
    // Every header link points at a section on the page.
    for (const href of await page.getByRole("navigation", { name: "Page" }).getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
      await expect(page.locator(href!)).toHaveCount(1);
    }
    // "Safe by design" (SUP-63): three statements and the privacy policy.
    const safe = page.getByRole("region", { name: "Safe by design" });
    await expect(safe.getByRole("heading", { level: 3 })).toHaveText([
      "The AI only suggests",
      "Customers see only their own tickets",
      "Ticket text can't give the AI orders",
    ]);
    await expect(safe.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy");
    // Pricing (SUP-51): Free and Custom; Custom's "Contact us" goes through
    // Support Triage itself (sign up, then a ticket).
    await page.getByRole("navigation", { name: "Page" }).getByRole("link", { name: "Pricing" }).click();
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
  // A signed-in user's "Contact us" opens a new ticket straight away.
  await expect(page.getByRole("region", { name: "Pricing" }).getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/tickets/new");
});
