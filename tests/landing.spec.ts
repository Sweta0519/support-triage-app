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
    for (const name of ["The queue", "A customer's view of their ticket", "An incident", "Analytics"]) {
      // Each screenshot is a button that enlarges it (SUP-62).
      const shot = page.getByRole("button", { name: `Enlarge: ${name}` });
      const img = shot.locator("img");
      await img.scrollIntoViewIfNeeded();
      await expect(img).toBeVisible();
      await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    }
    // Enlarging opens the full image in a dialog, sharper than the framed one,
    // with the page behind locked; Escape, Close and a click outside each
    // close it, and focus goes back to the screenshot.
    const queueShot = page.getByRole("button", { name: "Enlarge: The queue" });
    const lightbox = page.getByRole("dialog", { name: /^The queue/ });
    const shown = await queueShot.locator("img").evaluate((i: HTMLImageElement) => i.clientWidth);
    await queueShot.click();
    await expect(lightbox).toBeVisible();
    await expect(lightbox.getByRole("button", { name: "Close" })).toBeFocused();
    await expect.poll(() => lightbox.locator("img").evaluate((i: HTMLImageElement, w) => i.complete && i.naturalWidth > w, shown)).toBe(true);
    await expect(page.locator("html")).toHaveCSS("overflow", "hidden");
    await page.keyboard.press("Escape");
    await expect(lightbox).toBeHidden();
    await expect(queueShot).toBeFocused();
    await expect(page.locator("html")).not.toHaveCSS("overflow", "hidden");
    await queueShot.click();
    await lightbox.getByRole("button", { name: "Close" }).click();
    await expect(lightbox).toBeHidden();
    await queueShot.click();
    await page.mouse.click(5, 5); // the backdrop, well outside the image
    await expect(lightbox).toBeHidden();
    // The MCP connector (SUP-65): the setup for each tool, and only tools
    // that connect with a token today.
    const mcp = page.getByRole("region", { name: "From your AI assistant, too" });
    await expect(mcp).not.toContainText("Coming soon");
    await expect(mcp.getByRole("tabpanel")).toContainText("claude mcp add --transport http support-triage");
    await expect(mcp.getByRole("tabpanel")).toContainText("/api/mcp");
    await mcp.getByRole("tab", { name: "Cursor" }).click();
    await expect(mcp.getByRole("tab", { name: "Cursor" })).toHaveAttribute("aria-selected", "true");
    await expect(mcp.getByRole("tabpanel")).toContainText('"mcpServers"');
    await mcp.getByRole("tab", { name: "Cursor" }).press("ArrowRight");
    await expect(mcp.getByRole("tab", { name: "VS Code" })).toBeFocused();
    await expect(mcp.getByRole("tabpanel")).toContainText('"type": "http"');
    // In a workspace file the token comes from VS Code's secret prompt, never the file.
    await expect(mcp.getByRole("tabpanel")).toContainText("${input:support-triage-token}");
    await expect(mcp.getByRole("tabpanel")).not.toContainText("st_your_token");
    await page.keyboard.press("End");
    await expect(mcp.getByRole("tab", { name: "Codex" })).toBeFocused();
    await expect(mcp.getByRole("tabpanel")).toContainText('bearer_token_env_var = "SUPPORT_TRIAGE_TOKEN"');
    await page.keyboard.press("ArrowRight");
    await expect(mcp.getByRole("tab", { name: "Claude Code" })).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Home");
    await expect(mcp.getByRole("tab", { name: "Claude Code" })).toHaveAttribute("aria-selected", "true");
    // Copy puts exactly the setup on the clipboard, and says so.
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await mcp.getByRole("button", { name: /^Copy/ }).click();
    await expect(mcp.getByRole("button", { name: /^Copied/ })).toBeVisible();
    await expect(mcp.getByRole("status")).toHaveText("Copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^claude mcp add --transport http support-triage \\\n/);
    await expect(mcp.getByRole("list", { name: "Works with" }).getByRole("listitem")).toHaveText([
      "Claude Code",
      "Cursor",
      "VS Code + Copilot",
      "OpenAI Codex",
    ]);
    // Each mark in its brand colour (SUP-67): Claude's terracotta, the
    // monochrome marks in the page's ink.
    const marks = mcp.getByRole("list", { name: "Works with" }).locator("svg");
    expect(await marks.evaluateAll((svgs) => svgs.map((s) => getComputedStyle(s).color))).toEqual([
      "rgb(217, 119, 87)",
      "rgb(21, 23, 28)",
      "rgb(21, 23, 28)",
      "rgb(21, 23, 28)",
    ]);
    // Every header link points at a section on the page.
    for (const href of await page.getByRole("navigation", { name: "Page", exact: true }).getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
      await expect(page.locator(href!)).toHaveCount(1);
    }
    // "Safe by design" (SUP-63): three statements and the privacy policy.
    const safe = page.getByRole("region", { name: "Safe by design" });
    await expect(safe.getByRole("heading", { level: 3 })).toHaveText([
      "The AI only suggests",
      "Customers see only their own tickets",
      "Ticket text is information, not instructions",
    ]);
    await expect(safe.getByRole("link", { name: "privacy policy" })).toHaveAttribute("href", "/privacy");
    // The sentences that carry the claims, so the copy can't drift silently.
    await expect(safe).toContainText("never replies to a customer");
    await expect(safe).toContainText("row-level security on every table");
    await expect(safe).toContainText("its own workspace, which no other team can see");
    await expect(safe).toContainText("a read-only status page that staff choose to publish");
    await expect(safe).toContainText("checked against a strict format");
    // Pricing (SUP-51): Free and Custom; Custom's "Contact us" goes through
    // Support Triage itself (the Get in touch form, which files a ticket).
    await page.getByRole("navigation", { name: "Page", exact: true }).getByRole("link", { name: "Pricing", exact: true }).click();
    await expect(page).toHaveURL(/#pricing$/);
    const pricing = page.getByRole("region", { name: "Pricing" });
    await expect(pricing.getByRole("heading", { name: "Free" })).toBeVisible();
    await expect(pricing.getByRole("heading", { name: "Custom" })).toBeVisible();
    await expect(pricing.getByRole("link", { name: "Contact us" })).toHaveAttribute("href", "/signup?access=1");
    // Nothing promises agent access: "Get in touch" is a conversation (SUP-72).
    await expect(page.locator("main")).not.toContainText("agent access");

    await page.getByRole("navigation", { name: "Account", exact: true }).getByRole("link", { name: "Get in touch", exact: true }).click();
    await expect(page).toHaveURL(/\/signup\?access=1$/);
    await page.goto("/");
    await page.getByRole("navigation", { name: "Account", exact: true }).getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the page has share metadata, and the card is a 1200x630 PNG", async ({ page }) => {
    await page.goto("/");
    const meta = (property: string) => page.locator(`meta[property="${property}"]`).getAttribute("content");
    expect(await meta("og:title")).toMatch(/^Support Triage/);
    expect(await meta("og:site_name")).toBe("Support Triage");
    expect(await meta("og:image:width")).toBe("1200");
    expect(await meta("og:image:height")).toBe("630");
    expect(await meta("og:image:alt")).toMatch(/read and sorted before anyone opens it/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical!).pathname).toBe("/");
    // The card itself: served to signed-out visitors, and really 1200x630
    // (the PNG header stores width and height at bytes 16-23).
    const og = (await meta("og:image"))!;
    // Absolute, on this site's own address (NEXT_PUBLIC_SITE_URL), not a
    // placeholder host; and the Twitter card picks the same image up.
    expect(new URL(og).origin).toBe(new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").origin);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute("content", og);
    const image = await page.request.get(new URL(og).pathname);
    expect(image.headers()["content-type"]).toBe("image/png");
    const png = await image.body();
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });

  test("the page loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    // Fully rendered and hydrated: the hero's reveal has run.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Drafted reply, for an agent to edit and send")).toBeVisible();
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test("the footer links the sections, the account pages and the privacy policy", async ({ page }) => {
    await page.goto("/");
    const footer = page.getByRole("navigation", { name: "Footer", exact: true });
    const product = footer.getByRole("list", { name: "Product" });
    for (const href of await product.getByRole("link").evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
      await expect(page.locator(href!)).toHaveCount(1);
    }
    const account = footer.getByRole("list", { name: "Account" });
    await expect(account.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    await expect(account.getByRole("link", { name: "Get in touch" })).toHaveAttribute("href", "/signup?access=1");
    await expect(footer.getByRole("list", { name: "Legal" }).getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy");
    // Group titles are labels, not headings: no "Product" heading on the page.
    await expect(page.getByRole("heading", { name: "Product", exact: true })).toHaveCount(0);
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
  await expect(page.getByRole("navigation", { name: "Account", exact: true }).getByRole("link", { name: "Open the app" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get in touch", exact: true })).toHaveCount(0);
  // The footer's account group offers the app instead.
  await expect(page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("list", { name: "Account" }).getByRole("link")).toHaveText(["Open the app"]);
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
