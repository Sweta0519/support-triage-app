import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-76: staff presence. The Online / Away / Offline dropdown sits under
// a staff member's name in the sidebar. It only labels them, so changing
// the shared agent's presence can't disturb other spec files; each test
// still puts it back to Online.

// One session per account for the whole file: Supabase Auth rate-limits
// sign-ins, and the main suite already signs in many times in parallel.
const sessions = new Map<string, ReturnType<typeof signIn>>();

function signedIn(email: string, password: string) {
  let session = sessions.get(email);
  if (!session) {
    session = signIn(email, password);
    sessions.set(email, session);
  }
  return session;
}

async function signIn(email: string, password: string) {
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return db;
}

// Picks a status in the sidebar and waits for the save's answer. The
// select stays usable while it saves, so there's nothing on the page to
// wait for instead.
async function pick(page: Page, value: string) {
  const status = page.getByRole("complementary").getByLabel("Your status");
  if ((await status.inputValue()) === value) return; // no change, no save
  const saved = page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
  await status.selectOption(value);
  expect((await saved).ok()).toBe(true);
}

test.describe("staff presence", () => {
  // Two of these change the shared agent's presence, so they take turns.
  test.describe.configure({ mode: "serial" });

  test("an agent sets Away from the sidebar, and it sticks across a reload", async ({ browser }) => {
    const email = requireEnv("TEST_AGENT_EMAIL");
    const password = requireEnv("TEST_AGENT_PASSWORD");
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      await page.goto("/queue");
      const sidebar = page.getByRole("complementary");
      await pick(page, "online");

      await pick(page, "away");
      await expect(sidebar.getByTestId("presence-dot")).toHaveClass(/bg-amber-400/);

      await page.reload();
      await expect(sidebar.getByLabel("Your status")).toHaveValue("away");
      await expect(sidebar.getByTestId("presence-dot")).toHaveClass(/bg-amber-400/);

      await pick(page, "offline");
      await page.reload();
      await expect(sidebar.getByLabel("Your status")).toHaveValue("offline");
    } finally {
      const db = await signedIn(email, password);
      expect((await db.rpc("set_own_presence", { p_presence: "online" })).error).toBeNull();
      await context.close();
    }
  });

  test("when the save's answer is lost, the dropdown shows what the server saved", async ({ browser }) => {
    const email = requireEnv("TEST_AGENT_EMAIL");
    const password = requireEnv("TEST_AGENT_PASSWORD");
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      await page.goto("/queue");
      await pick(page, "online");
      const sidebar = page.getByRole("complementary");
      // The next action reaches the server and saves, but its answer never
      // comes back. Only once: the read that follows gets through.
      await page.route(
        "**/queue",
        async (route) => {
          const request = route.request();
          if (request.method() !== "POST" || request.postData() !== '["away"]') return route.fallback();
          await route.fetch();
          await route.abort();
        },
        { times: 1 },
      );
      // The read that follows the lost answer: wait for it, then check.
      const read = page.waitForResponse((r) => r.request().method() === "POST" && r.request().postData() === "[]");
      await sidebar.getByLabel("Your status").selectOption("away");
      await read;
      await expect(sidebar.getByLabel("Your status")).toHaveValue("away");
      await expect(sidebar.getByTestId("presence-dot")).toHaveClass(/bg-amber-400/);
      await expect(sidebar.getByRole("alert")).toHaveCount(0);
      await page.reload();
      await expect(sidebar.getByLabel("Your status")).toHaveValue("away");
    } finally {
      const db = await signedIn(email, password);
      expect((await db.rpc("set_own_presence", { p_presence: "online" })).error).toBeNull();
      await context.close();
    }
  });

  test("signing out sets an agent Offline, and they stay Offline until they choose otherwise", async ({ browser }) => {
    const email = requireEnv("TEST_AGENT_EMAIL");
    const password = requireEnv("TEST_AGENT_PASSWORD");
    const db = await signedIn(email, password);
    const presence = async () => (await db.from("profiles").select("presence").eq("email", email).single()).data?.presence;
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, email, password);
      await page.goto("/queue");
      await expect(page.getByRole("complementary").getByLabel("Your status")).toHaveValue("online");
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect(await presence()).toBe("offline");

      // Signing back in doesn't change it: presence is the person's choice.
      await login(page, email, password);
      await page.goto("/queue");
      await expect(page.getByRole("complementary").getByLabel("Your status")).toHaveValue("offline");
    } finally {
      expect((await db.rpc("set_own_presence", { p_presence: "online" })).error).toBeNull();
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
    // Customer A's row: nothing in the suite changes a customer's presence
    // (a staff row changes whenever that person signs out or picks a status).
    const customerEmail = requireEnv("TEST_USER_EMAIL");
    const admin = await signedIn(requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
    const customerPresence = async () =>
      (await admin.from("profiles").select("presence").eq("email", customerEmail).single()).data?.presence;
    const before = await customerPresence();
    expect(before).toBeTruthy();

    const db = await signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
    const { error } = await db.rpc("set_own_presence", { p_presence: "busy" });
    expect(error?.code).toBe("22023");

    // No UPDATE grant on profiles: a direct write is refused outright.
    const target = before === "offline" ? "away" : "offline";
    const { error: direct } = await db.from("profiles").update({ presence: target }).eq("email", customerEmail);
    expect(direct).not.toBeNull();
    // And the agent setting their own status leaves everyone else's alone.
    expect((await db.rpc("set_own_presence", { p_presence: target })).error).toBeNull();
    expect(await customerPresence()).toBe(before);
    expect((await db.rpc("set_own_presence", { p_presence: "online" })).error).toBeNull();
  });
});
