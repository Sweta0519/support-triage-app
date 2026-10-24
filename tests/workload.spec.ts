import { test, expect, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv, selectStaffByEmail } from "./helpers";

// SUP-77: Admin > Workload -- a daily cap on new cases per person, and
// their workplace timezone. Runs in its own "workload" project after the
// rest of the suite (playwright.config.ts): a cap on the shared test agent
// would refuse other specs' claims. Every test puts the agent back to no
// cap, UTC and no working hours.

// One session per account for the whole file: Supabase Auth rate-limits
// sign-ins, and these tests make many calls.
type Db = Awaited<ReturnType<typeof signIn>>;
const sessions = new Map<string, Promise<Db>>();

function signedIn(email: string, password: string): Promise<Db> {
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

const asAdmin = () => signedIn(requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
const asAgent = () => signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
const asCustomer = () => signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));

type Row = {
  id: string;
  email: string;
  daily_case_cap: number | null;
  timezone: string;
  assigned_today: number;
  work_days: number[] | null;
  work_start: string | null;
  work_end: string | null;
};

// No working hours (SUP-85).
const NO_HOURS = { p_work_days: null, p_work_start: null, p_work_end: null };

async function agentRow(admin: Db): Promise<Row> {
  const { data, error } = await admin.rpc("admin_workload");
  expect(error).toBeNull();
  const row = (data as Row[]).find((r) => r.email.toLowerCase() === requireEnv("TEST_AGENT_EMAIL").toLowerCase());
  if (!row) throw new Error("The test agent isn't on the Workload page");
  return row;
}

async function resetAgent(admin: Db) {
  const row = await agentRow(admin);
  const { error } = await admin.rpc("admin_set_workload", { p_target: row.id, p_cap: null, p_timezone: "UTC", ...NO_HOURS });
  expect(error).toBeNull();
}

// Unassigned tickets filed by customer A; the subject's 13-digit suffix
// marks them for tests/cleanup.teardown.ts.
async function fileProbes(count: number): Promise<string[]> {
  const customer = await asCustomer();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const { data, error } = await customer
      .from("tickets")
      .insert({ subject: `Workload probe ${Date.now()}`, body: "Filed by tests/workload.spec.ts." })
      .select("id")
      .single();
    expect(error).toBeNull();
    ids.push(data!.id);
  }
  return ids;
}

async function staffPage(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

test.describe("admin workload", () => {
  test.describe.configure({ mode: "serial" });

  test.afterEach(async () => {
    await resetAgent(await asAdmin());
  });

  test("an admin sets a cap and a timezone on the Workload page, and they stick", async ({ browser }) => {
    const { context, page } = await staffPage(browser, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
    try {
      await page.goto("/admin");
      await page.getByRole("link", { name: "Workload", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/workload$/);

      // Every row shows the person's email, display name or not.
      const target = page.getByRole("row").filter({ hasText: requireEnv("TEST_AGENT_EMAIL") });

      await target.getByRole("spinbutton").fill("7");
      await target.getByRole("combobox").selectOption("Europe/Berlin");
      await target.getByRole("button", { name: "Save" }).click();
      await expect(target.getByRole("status")).toHaveText("Saved.");
      // React resets the form after a save: the fields show the saved
      // values, not the ones they first rendered with.
      await expect(target.getByRole("combobox")).toHaveValue("Europe/Berlin");
      await expect(target.getByRole("spinbutton")).toHaveValue("7");

      // Saving only a new cap keeps the timezone just saved.
      await target.getByRole("spinbutton").fill("8");
      await target.getByRole("button", { name: "Save" }).click();
      await expect(target.getByRole("spinbutton")).toHaveValue("8");
      await expect(target.getByRole("combobox")).toHaveValue("Europe/Berlin");

      await page.reload();
      const after = page.getByRole("row").filter({ hasText: requireEnv("TEST_AGENT_EMAIL") });
      await expect(after.getByRole("combobox")).toHaveValue("Europe/Berlin");
      await expect(after.getByRole("spinbutton")).toHaveValue("8");
      await expect(after.getByText(/there now$/)).toBeVisible();
      await expect(after.getByText(/ of 8$/)).toBeVisible();

      // A number out of range doesn't get past the browser (the action and
      // the database refuse it too: see the last test).
      await after.getByRole("spinbutton").fill("500");
      await after.getByRole("button", { name: "Save" }).click();
      expect(await after.getByRole("spinbutton").evaluate((el: HTMLInputElement) => el.validity.rangeOverflow)).toBe(true);
      await expect(after.getByRole("status")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("the cap refuses one claim too many, everywhere, and a ticket given back doesn't count twice", async ({
    browser,
  }) => {
    const admin = await asAdmin();
    const agent = await asAgent();
    const row = await agentRow(admin);
    // Room for exactly one more new case today, whatever the suite did before.
    const cap = row.assigned_today + 1;
    expect((await admin.rpc("admin_set_workload", { p_target: row.id, p_cap: cap, p_timezone: "Europe/Berlin", ...NO_HOURS })).error).toBeNull();
    const [first, second] = await fileProbes(2);

    // The first claim fits under the cap.
    const claimed = await agent.from("tickets").update({ assignee_id: row.id }).eq("id", first).is("assignee_id", null).select("id");
    expect(claimed.error).toBeNull();
    expect(claimed.data).toHaveLength(1);
    expect((await agentRow(admin)).assigned_today).toBe(cap);

    // The second is refused by the database, whoever asks.
    const refused = await agent.from("tickets").update({ assignee_id: row.id }).eq("id", second).is("assignee_id", null);
    expect(refused.error?.message).toContain("daily_case_cap_reached");
    const byAdmin = await admin.from("tickets").update({ assignee_id: row.id }).eq("id", second);
    expect(byAdmin.error?.message).toContain("daily_case_cap_reached");

    // The agent's Claim button says why.
    const agentUi = await staffPage(browser, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
    try {
      await agentUi.page.goto(`/tickets/${second}`);
      await agentUi.page.getByRole("button", { name: "Claim ticket" }).click();
      await expect(agentUi.page.getByRole("status").filter({ hasText: "daily limit of new cases" })).toBeVisible();
      await expect(agentUi.page.getByText("Unassigned", { exact: true })).toBeVisible();
    } finally {
      await agentUi.context.close();
    }

    // So does the admin's Reassign, naming the agent.
    const adminUi = await staffPage(browser, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
    try {
      await adminUi.page.goto(`/tickets/${second}`);
      await selectStaffByEmail(adminUi.page, requireEnv("TEST_AGENT_EMAIL"));
      await adminUi.page.getByRole("button", { name: "Assign", exact: true }).click();
      await expect(
        adminUi.page.getByRole("status").filter({ hasText: "has reached their daily limit of new cases" })
      ).toBeVisible();
    } finally {
      await adminUi.context.close();
    }

    // Unassigned and claimed again the same day: not a new case.
    expect((await admin.from("tickets").update({ assignee_id: null }).eq("id", first)).error).toBeNull();
    const again = await agent.from("tickets").update({ assignee_id: row.id }).eq("id", first).is("assignee_id", null).select("id");
    expect(again.error).toBeNull();
    expect(again.data).toHaveLength(1);

    // Filing a ticket with "Assign to me" is a new case too.
    const filed = await agent.rpc("staff_create_ticket", {
      p_customer_email: requireEnv("TEST_USER_EMAIL"),
      p_subject: `Workload probe ${Date.now()}`,
      p_body: "Filed by tests/workload.spec.ts.",
      p_assign_to_me: true,
    });
    expect(filed.error?.message).toContain("daily_case_cap_reached");

    // No cap: the refused ticket can be claimed after all.
    await resetAgent(admin);
    const open = await agent.from("tickets").update({ assignee_id: row.id }).eq("id", second).is("assignee_id", null).select("id");
    expect(open.error).toBeNull();
    expect(open.data).toHaveLength(1);
  });

  test("two claims at once can't both slip under the cap", async () => {
    const admin = await asAdmin();
    const row = await agentRow(admin);
    expect((await admin.rpc("admin_set_workload", { p_target: row.id, p_cap: row.assigned_today + 1, p_timezone: "UTC", ...NO_HOURS })).error).toBeNull();
    const probes = await fileProbes(3);
    // Sent together: each request is its own transaction in PostgREST.
    const agent = await asAgent();
    const results = await Promise.all(
      probes.map((id) => agent.from("tickets").update({ assignee_id: row.id }).eq("id", id).is("assignee_id", null).select("id"))
    );
    expect(results.filter((r) => !r.error && r.data?.length === 1)).toHaveLength(1);
    expect(results.filter((r) => r.error?.message.includes("daily_case_cap_reached"))).toHaveLength(2);
  });

  test("only admins read or change workload, and only with valid values", async () => {
    const agent = await asAgent();
    expect((await agent.rpc("admin_workload")).error?.code).toBe("42501");
    const row = await agentRow(await asAdmin());
    expect((await agent.rpc("admin_set_workload", { p_target: row.id, p_cap: 50, p_timezone: "UTC", ...NO_HOURS })).error?.code).toBe(
      "42501"
    );

    const admin = await asAdmin();
    expect((await admin.rpc("admin_set_workload", { p_target: row.id, p_cap: 5, p_timezone: "Mars/Olympus", ...NO_HOURS })).error?.code).toBe(
      "22023"
    );
    expect((await admin.rpc("admin_set_workload", { p_target: row.id, p_cap: -1, p_timezone: "UTC", ...NO_HOURS })).error?.code).toBe("22023");

    // A customer can't be given a cap.
    const customerId = (await (await asCustomer()).auth.getUser()).data.user!.id;
    expect((await admin.rpc("admin_set_workload", { p_target: customerId, p_cap: 5, p_timezone: "UTC", ...NO_HOURS })).error?.code).toBe(
      "P0002"
    );

    // And nobody writes the columns directly.
    expect((await admin.from("profiles").update({ daily_case_cap: 1 }).eq("id", row.id)).error).not.toBeNull();
  });

  // SUP-85. When the status follows the hours (no pick since the last shift
  // start or end) is covered in tests/work-hours.spec.ts: a pick can't be
  // backdated from here.
  test("an admin sets working hours, and a status picked since the shift began holds", async ({ browser }) => {
    const admin = await asAdmin();
    const agent = await asAgent();
    expect((await agent.rpc("set_own_presence", { p_presence: "away" })).error).toBeNull();

    const { context, page } = await staffPage(browser, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
    try {
      await page.goto("/admin/workload");
      const target = page.getByRole("row").filter({ hasText: requireEnv("TEST_AGENT_EMAIL") });
      await expect(target.getByText("Set by hand")).toHaveCount(0);

      // Every day, all day, in UTC: the shift began at midnight, before the
      // agent picked Away just now.
      for (const day of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
        // The day's letter, as a person clicks it: it covers the checkbox.
        await target.getByTitle(day).click();
        await expect(target.getByRole("checkbox", { name: day })).toBeChecked();
      }
      await target.getByLabel(/^Shift start for/).fill("00:00");
      await target.getByLabel(/^Shift end for/).fill("23:59");
      await target.getByRole("button", { name: "Save" }).click();
      await expect(target.getByRole("status")).toHaveText("Saved.");
      await expect(target.getByText("Set by hand")).toBeVisible();
      await expect(target.getByText("Away", { exact: true })).toBeVisible();

      await page.reload();
      const after = page.getByRole("row").filter({ hasText: requireEnv("TEST_AGENT_EMAIL") });
      await expect(after.getByRole("checkbox", { name: "Sun" })).toBeChecked();
      await expect(after.getByLabel(/^Shift end for/)).toHaveValue("23:59");

      const row = await agentRow(admin);
      expect(row.work_days).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(row.work_start).toBe("00:00:00");
      expect(row.work_end).toBe("23:59:00");

      // A start without an end, or with no days, isn't a schedule.
      await after.getByLabel(/^Shift end for/).fill("");
      await after.getByRole("button", { name: "Save" }).click();
      await expect(after.getByRole("alert")).toContainText("pick at least one day");
      expect((await agentRow(admin)).work_end).toBe("23:59:00");
    } finally {
      await context.close();
      expect((await agent.rpc("set_own_presence", { p_presence: "online" })).error).toBeNull();
    }
  });

  test("working hours are checked, and written only through admin_set_workload()", async () => {
    const admin = await asAdmin();
    const row = await agentRow(admin);
    const set = (hours: Record<string, unknown>) =>
      admin.rpc("admin_set_workload", { p_target: row.id, p_cap: null, p_timezone: "UTC", ...NO_HOURS, ...hours });

    expect((await set({ p_work_days: [1], p_work_start: "09:00" })).error?.code).toBe("22023");
    expect((await set({ p_work_days: [], p_work_start: "09:00", p_work_end: "17:00" })).error?.code).toBe("22023");
    expect((await set({ p_work_days: [8], p_work_start: "09:00", p_work_end: "17:00" })).error?.code).toBe("22023");
    expect((await set({ p_work_days: [1], p_work_start: "09:00", p_work_end: "09:00" })).error?.code).toBe("22023");

    // Repeats and order don't matter; a night shift is fine.
    expect((await set({ p_work_days: [5, 1, 5], p_work_start: "22:00", p_work_end: "06:00" })).error).toBeNull();
    expect((await agentRow(admin)).work_days).toEqual([1, 5]);

    // Cleared again by all three nulls.
    expect((await set({})).error).toBeNull();
    expect((await agentRow(admin)).work_days).toBeNull();

    expect((await admin.from("profiles").update({ work_days: [1] }).eq("id", row.id)).error).not.toBeNull();
  });
});
