import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-22: account settings. Runs in its own "settings" project after the
// main suite (playwright.config.ts): it changes the shared test accounts'
// theme and queue defaults, and the agent's queue opening on "Mine" would
// break any queue test running alongside it. Every test puts the settings
// back.

function anonClient() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedIn(email: string, password: string) {
  const db = anonClient();
  const { error } = await db.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return db;
}

const DEFAULTS = { p_full_name: "", p_theme: "system", p_queue_default_filter: "all", p_queue_default_sort: "sla" };

test.describe("account settings", () => {
  test.describe.configure({ mode: "serial" });

  test("a customer saves a display name and a theme, and the theme applies", async ({ browser }) => {
    const email = requireEnv("TEST_USER_EMAIL");
    const password = requireEnv("TEST_USER_PASSWORD");
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      await page.goto("/account");
      // Customers have no queue, so no queue preferences.
      await expect(page.getByLabel("Queue opens on")).toHaveCount(0);

      const name = `Settings probe ${Date.now()}`;
      await page.getByLabel("Display name").fill(`  ${name}  `);
      await page.getByLabel("Theme").selectOption("dark");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("status")).toHaveText("Settings saved.");

      await page.reload();
      await expect(page.getByLabel("Display name")).toHaveValue(name);
      await expect(page.getByLabel("Theme")).toHaveValue("dark");
      // The app layout carries the choice, and the page really is dark.
      await expect(page.locator("[data-theme=dark]")).toHaveCount(1);
      await expect(page.locator("[data-theme=dark]")).toHaveCSS("background-color", "rgb(10, 10, 10)");

      // "Light" wins over a device set to dark: the background and the
      // dark: utility classes both stay light.
      await page.emulateMedia({ colorScheme: "dark" });
      await page.getByLabel("Theme").selectOption("light");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("status")).toHaveText("Settings saved.");
      await page.reload();
      const light = page.locator("[data-theme=light]");
      await expect(light).toHaveCSS("background-color", "rgb(255, 255, 255)");
      await expect(page.getByRole("heading", { name: "Account settings" })).toHaveCSS("color", "rgb(0, 0, 0)");

      // An overlong name is refused, and nothing changes.
      await page.getByLabel("Display name").evaluate((el) => el.removeAttribute("maxlength"));
      await page.getByLabel("Display name").fill("x".repeat(81));
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("status")).toHaveText(/80 characters or fewer/);
      await page.reload();
      await expect(page.getByLabel("Display name")).toHaveValue(name);
    } finally {
      const db = await signedIn(email, password);
      const { error } = await db.rpc("update_own_profile", DEFAULTS);
      expect(error).toBeNull();
      await context.close();
    }
  });

  test("an agent's queue opens on their saved tab and sort", async ({ browser }) => {
    const email = requireEnv("TEST_AGENT_EMAIL");
    const password = requireEnv("TEST_AGENT_PASSWORD");
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      await page.goto("/account");
      await page.getByLabel("Queue opens on").selectOption("mine");
      await page.getByLabel("Queue sorted by").selectOption("newest");
      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("status")).toHaveText("Settings saved.");

      await page.goto("/queue");
      const tabs = page.getByRole("navigation", { name: "Assignment" });
      await expect(tabs.getByRole("link", { name: /^Mine/ })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("link", { name: "Newest", exact: true })).toHaveAttribute("aria-current", "page");

      // "All" is no longer the default, so its link spells it out -- and
      // following it shows All, not the saved tab.
      const all = tabs.getByRole("link", { name: /^All/ });
      await expect(all).toHaveAttribute("href", "/queue?filter=all");
      await all.click();
      await expect(page).toHaveURL(/\/queue\?filter=all$/);
      await expect(tabs.getByRole("link", { name: /^All/ })).toHaveAttribute("aria-current", "page");
      // The saved sort still applies on the All tab.
      await expect(page.getByRole("link", { name: "Newest", exact: true })).toHaveAttribute("aria-current", "page");
    } finally {
      const db = await signedIn(email, password);
      const { error } = await db.rpc("update_own_profile", DEFAULTS);
      expect(error).toBeNull();
      await context.close();
    }
  });

  test("the settings path can't change a role, an email or anyone else's profile", async () => {
    const db = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
    const { data: me } = await db.from("profiles").select("id, email, role").single();
    expect(me?.role).toBe("customer");

    // No UPDATE grant on profiles at all: role, email and name are all refused.
    for (const change of [{ role: "admin" }, { email: "someone@example.com" }, { full_name: "Direct" }]) {
      const { error } = await db.from("profiles").update(change).eq("id", me!.id);
      expect(error?.code).toBe("42501");
    }

    // update_own_profile() takes no user id, so there is nothing to point at
    // another account; an extra argument doesn't match the function at all.
    const { error: extraArg } = await db.rpc("update_own_profile", { ...DEFAULTS, p_user_id: me!.id });
    expect(extraArg).not.toBeNull();

    // A value outside the allowed set is refused by the column constraint.
    const { error: badTheme } = await db.rpc("update_own_profile", { ...DEFAULTS, p_theme: "neon" });
    expect(badTheme?.code).toBe("23514");

    const { data: after } = await db.from("profiles").select("email, role").single();
    expect(after).toEqual({ email: me!.email, role: "customer" });
  });
});
