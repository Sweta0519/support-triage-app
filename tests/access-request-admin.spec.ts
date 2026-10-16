import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-68: admins see access requests waiting (a sidebar count), review them
// in one place, and grant or decline in one step. Throwaway accounts only;
// the live database may hold real requests too, so counts are compared
// before and after rather than asserted outright.

test.use({ storageState: { cookies: [], origins: [] } });
// One at a time: the tests decide requests, and the sidebar count is global.
test.describe.configure({ mode: "serial" });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedIn(email: string, password: string) {
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expect((await db.auth.signInWithPassword({ email, password })).error).toBeNull();
  return db;
}

type Account = { id: string; email: string; password: string; name: string };
const made: Account[] = [];

async function account(tag: string, opts: { role?: "agent" | "admin"; request?: boolean } = {}): Promise<Account> {
  const admin = service();
  const email = `e2e-${tag}-${Date.now()}-${randomUUID().slice(0, 6)}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const name = `${tag} ${randomUUID().slice(0, 4)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: opts.request ? { access_request: { team: `${name} team`, size: "6-20", purpose: "Our inbox." } } : undefined,
  });
  expect(error).toBeNull();
  const a = { id: data.user!.id, email, password, name };
  made.push(a);
  expect((await admin.from("profiles").update({ full_name: name, ...(opts.role ? { role: opts.role } : {}) }).eq("id", a.id)).error).toBeNull();
  if (opts.request) {
    // Filed as the first sign-in would (SUP-58).
    const db = await signedIn(email, password);
    expect((await db.rpc("file_access_request")).data).toHaveLength(1);
  }
  return a;
}

test.afterEach(async () => {
  const admin = service();
  for (const a of made.splice(0)) {
    await admin.from("tickets").delete().eq("customer_id", a.id);
    await admin.auth.admin.deleteUser(a.id);
  }
});

const sidebarCount = async (page: Page) => {
  const link = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Access requests/ });
  const text = (await link.textContent()) ?? "";
  return Number(text.match(/(\d+)\s*waiting/)?.[1] ?? 0);
};

test("an admin sees the count, reviews requests in one place, and grants one in a step", async ({ page }) => {
  test.setTimeout(90_000);
  const requester = await account("Requester", { request: true });
  const admin = await account("Admin", { role: "admin" });
  await login(page, admin.email, admin.password);

  // The sidebar shows how many are waiting, ours included.
  expect(await sidebarCount(page)).toBeGreaterThanOrEqual(1);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Access requests/ }).click();
  await expect(page).toHaveURL(/\/admin\/access-requests$/);

  const card = page.getByRole("listitem", { name: `Request from ${requester.name}` });
  await expect(card).toContainText(`${requester.name} team`);
  await expect(card).toContainText("Team size: 6-20");
  await card.getByRole("button", { name: "Grant agent access…" }).click();
  await card.getByRole("button", { name: `Make ${requester.name} an agent` }).click();
  await expect(card.getByRole("status")).toContainText(`${requester.name} is now an agent.`);

  // Done in one step: the role, a reply on their ticket, and the ticket resolved.
  const db = service();
  const { data: profile } = await db
    .from("profiles")
    .select("role, access_request_status, access_decided_by, access_request_ticket_id")
    .eq("id", requester.id)
    .single();
  expect(profile).toMatchObject({ role: "agent", access_request_status: "granted", access_decided_by: admin.id });
  const { data: ticket } = await db.from("tickets").select("status").eq("id", profile!.access_request_ticket_id).single();
  expect(ticket!.status).toBe("resolved");
  const { data: comments } = await db.from("ticket_comments").select("author_id, body, is_internal").eq("ticket_id", profile!.access_request_ticket_id);
  expect(comments).toEqual([expect.objectContaining({ author_id: admin.id, is_internal: false, body: expect.stringContaining("agent access") })]);

  // They leave the Waiting list (the count is global, and other tests file
  // requests in parallel, so it's not compared exactly), and the history
  // says who decided.
  await page.reload();
  await expect(page.getByRole("listitem", { name: `Request from ${requester.name}` })).toHaveCount(0);
  await expect(page.getByRole("list", { name: "Handled requests" })).toContainText(`${requester.name}`);
  await expect(page.getByRole("list", { name: "Handled requests" })).toContainText(`Granted by ${admin.name}`);
  // And the Users page marks them.
  await page.goto("/admin/users");
  await expect(page.getByRole("row", { name: new RegExp(requester.name) })).toContainText("Access request granted");
});

test("an admin declines from the request's ticket; the requester stays a customer", async ({ page }) => {
  const requester = await account("Requester", { request: true });
  const admin = await account("Admin", { role: "admin" });
  const { data: profile } = await service().from("profiles").select("access_request_ticket_id").eq("id", requester.id).single();
  await login(page, admin.email, admin.password);
  await page.goto(`/tickets/${profile!.access_request_ticket_id}`);
  await page.getByRole("button", { name: "Decline…" }).click();
  await page.getByRole("button", { name: `Decline ${requester.name}'s request` }).click();
  await expect(page.getByRole("status").filter({ hasText: "Declined" })).toBeVisible();

  const { data: after } = await service().from("profiles").select("role, access_request_status").eq("id", requester.id).single();
  expect(after).toEqual({ role: "customer", access_request_status: "declined" });
  const { data: ticket } = await service().from("tickets").select("status").eq("id", profile!.access_request_ticket_id).single();
  expect(ticket!.status).toBe("resolved");
});

test("granting a request from someone already on the staff never demotes them", async () => {
  const otherAdmin = await account("Staffer", { request: true });
  await service().from("profiles").update({ role: "admin" }).eq("id", otherAdmin.id);
  const admin = await account("Admin", { role: "admin" });
  const adminDb = await signedIn(admin.email, admin.password);
  expect((await adminDb.rpc("decide_access_request", { p_user: otherAdmin.id, p_grant: true })).data).toBe("granted");
  const { data: after } = await service().from("profiles").select("role, access_request_status").eq("id", otherAdmin.id).single();
  expect(after).toEqual({ role: "admin", access_request_status: "granted" });
});

test("promoting a requester on the Users page settles their request too", async () => {
  const requester = await account("Requester", { request: true });
  const admin = await account("Admin", { role: "admin" });
  const adminDb = await signedIn(admin.email, admin.password);
  // What the Users page's role change calls.
  expect((await adminDb.rpc("admin_set_role", { target_user_id: requester.id, new_role: "agent" })).error).toBeNull();
  const { data } = await service().from("profiles").select("role, access_request_status, access_decided_by").eq("id", requester.id).single();
  expect(data).toEqual({ role: "agent", access_request_status: "granted", access_decided_by: admin.id });
});

test("only admins can see or decide requests, a request is decided once, and never your own", async ({ page }) => {
  const requester = await account("Requester", { request: true });
  const agent = await account("Agent", { role: "agent" });
  const admin = await account("Admin", { role: "admin" });

  // An agent: no sidebar item, the page refuses, and the database refuses.
  await login(page, agent.email, agent.password);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Access requests/ })).toHaveCount(0);
  await page.goto("/admin/access-requests");
  await expect(page).toHaveURL(/\/403$/);
  const agentDb = await signedIn(agent.email, agent.password);
  expect((await agentDb.rpc("decide_access_request", { p_user: requester.id, p_grant: true })).error?.code).toBe("42501");
  expect((await service().from("profiles").select("role").eq("id", requester.id).single()).data!.role).toBe("customer");

  // An admin decides it once; a second decision is refused.
  const adminDb = await signedIn(admin.email, admin.password);
  expect((await adminDb.rpc("decide_access_request", { p_user: requester.id, p_grant: false })).data).toBe("declined");
  expect((await adminDb.rpc("decide_access_request", { p_user: requester.id, p_grant: true })).error?.message).toBe("not_pending");

  // An admin with a request of their own can't decide it.
  const selfRequester = await account("Self", { request: true });
  await service().from("profiles").update({ role: "admin" }).eq("id", selfRequester.id);
  const selfDb = await signedIn(selfRequester.email, selfRequester.password);
  expect((await selfDb.rpc("decide_access_request", { p_user: selfRequester.id, p_grant: true })).error?.message).toBe("own_request");
});

test("admins are told about waiting requests in the tab title and on the phone menu button; agents aren't", async ({ page }) => {
  await account("Requester", { request: true });
  const admin = await account("Admin", { role: "admin" });
  const agent = await account("Agent", { role: "agent" });

  // The tab title carries the count, and keeps it across pages (SUP-71).
  await login(page, admin.email, admin.password);
  await expect(page).toHaveTitle(/^\(\d+\) /);
  await page.goto("/queue");
  await expect(page).toHaveTitle(/^\(\d+\) /);
  // On a phone the sidebar is behind the menu button, which shows a dot
  // and says how many are waiting.
  await page.setViewportSize({ width: 390, height: 800 });
  const menu = page.getByRole("button", { name: /^Open menu, \d+ access requests? waiting$/ });
  await expect(menu).toBeVisible();
  await expect(page.getByTestId("menu-dot")).toBeVisible();
  // Opening the menu shows the badge itself.
  await menu.click();
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Access requests/ })).toBeVisible();

  // An agent gets neither.
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await login(page, agent.email, agent.password);
  await expect(page).not.toHaveTitle(/^\(\d+\) /);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole("button", { name: "Open menu" })).toBeVisible();
  await expect(page.getByTestId("menu-dot")).toHaveCount(0);
});
