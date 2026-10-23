import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-76: staff presence. The Online / Away / Offline dropdown sits under
// a staff member's name in the sidebar. It only labels them, so changing
// the shared agent's presence can't disturb tests running alongside; each
// test still puts it back to Online.

async function signedIn(email: string, password: string) {
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return db;
}

test.describe("staff presence", () => {
  test("an agent sets Away from the sidebar, and it sticks across a reload", async ({ browser }) => {
    const email = requireEnv("TEST_AGENT_EMAIL");
    const password = requireEnv("TEST_AGENT_PASSWORD");
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      await page.goto("/queue");
      const sidebar = page.getByRole("complementary");
      const status = sidebar.getByLabel("Your status");
      await status.selectOption("online");
      await expect(status).toBeEnabled();

      await status.selectOption("away");
      await expect(status).toBeEnabled();
      await expect(sidebar.getByTestId("presence-dot")).toHaveClass(/bg-amber-400/);

      await page.reload();
      await expect(sidebar.getByLabel("Your status")).toHaveValue("away");
      await expect(sidebar.getByTestId("presence-dot")).toHaveClass(/bg-amber-400/);

      await sidebar.getByLabel("Your status").selectOption("offline");
      await expect(sidebar.getByLabel("Your status")).toBeEnabled();
      await page.reload();
      await expect(sidebar.getByLabel("Your status")).toHaveValue("offline");
    } finally {
      const db = await signedIn(email, password);
      await db.rpc("set_own_presence", { p_presence: "online" });
      await context.close();
    }
  });

  test("an admin has the dropdown too", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
      await page.goto("/admin");
      await expect(page.getByRole("complementary").getByLabel("Your status")).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("a customer has no dropdown, and the database refuses them", async ({ page }) => {
    // The default storage state is customer A, already signed in.
    await page.goto("/tickets");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByLabel("Your status")).toHaveCount(0);
    await expect(page.getByTestId("presence-dot")).toHaveCount(0);

    const db = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
    const { error } = await db.rpc("set_own_presence", { p_presence: "away" });
    expect(error?.code).toBe("42501");
  });

  test("the database refuses a value outside the three, and never touches anyone else", async () => {
    const db = await signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
    const { error } = await db.rpc("set_own_presence", { p_presence: "busy" });
    expect(error?.code).toBe("22023");

    // No UPDATE grant on profiles: a direct write is refused outright.
    const { error: direct } = await db
      .from("profiles")
      .update({ presence: "offline" })
      .eq("email", requireEnv("TEST_ADMIN_EMAIL"));
    expect(direct).not.toBeNull();
  });
});
