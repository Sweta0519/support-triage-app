import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// SUP-82: sign-up picks the workspace. A plain sign-up creates one (admin),
// a workspace's link signs up customers, and an invite signs up one agent
// for one email. Accounts made here are deleted afterwards; a workspace goes
// with its last member. This project confirms emails automatically, so the
// real form signs people straight in (SUP-69).

test.use({ storageState: { cookies: [], origins: [] } });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const created: string[] = [];

// Customers and agents first: a workspace's last admin can't be deleted
// while others are still in it.
test.afterAll(async () => {
  const db = service();
  const { data: members } = await db.from("workspace_members").select("user_id, role").in("user_id", created);
  const order = [...(members ?? [])].sort((a, b) => Number(a.role === "admin") - Number(b.role === "admin"));
  for (const m of order) await db.auth.admin.deleteUser(m.user_id);
});

function newEmail(kind: string) {
  return `e2e-ws-${kind}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
}

async function membership(email: string) {
  const { data } = await service()
    .from("profiles")
    .select("id, membership:workspace_members!inner(role, workspace_id)")
    .eq("email", email)
    .single();
  created.push(data!.id);
  return { id: data!.id as string, ...(data!.membership as unknown as { role: string; workspace_id: string }) };
}

// A workspace with its admin, made through the Admin API (the same trigger
// the form reaches).
async function newWorkspace(name: string) {
  const email = newEmail("admin");
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await service().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { workspace_name: name },
  });
  expect(error).toBeNull();
  created.push(data.user!.id);
  const { workspace_id } = await membership(email);
  const { data: ws } = await service().from("workspaces").select("join_token").eq("id", workspace_id).single();
  return { email, password, workspaceId: workspace_id, joinToken: ws!.join_token as string };
}

async function signUp(page: Page, email: string) {
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(`Pw-${randomUUID()}`);
  await page.getByRole("button", { name: "Sign up" }).click();
}

test("a plain sign-up creates a workspace, with the new account as its admin", async ({ page }) => {
  const email = newEmail("create");
  await page.goto("/signup");
  await expect(page.getByText("Set up a support workspace for your team.")).toBeVisible();
  await page.getByLabel("Team or company name").fill("Initech Support");
  await signUp(page, email);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 15_000 });

  const me = await membership(email);
  expect(me.role).toBe("admin");
  const { data: ws } = await service().from("workspaces").select("name, is_default").eq("id", me.workspace_id).single();
  expect(ws).toEqual({ name: "Initech Support", is_default: false });

  await page.goto("/admin/workspace");
  await expect(page.getByRole("heading", { name: "Initech Support" })).toBeVisible();
  await expect(page.getByLabel("Customer sign-up link")).toHaveValue(/\/join\/[0-9a-f]{48}$/);
});

test("a workspace's link signs up customers of that workspace, and only new accounts", async ({ page }) => {
  const ws = await newWorkspace("Hooli Help");

  await page.goto("/join/0000");
  await expect(page.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();

  await page.goto(`/join/${ws.joinToken}`);
  await expect(page.getByRole("heading", { name: "Get support from Hooli Help" })).toBeVisible();
  await expect(page.getByLabel("Team or company name")).toHaveCount(0);
  const email = newEmail("customer");
  await signUp(page, email);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 15_000 });
  expect(await membership(email)).toMatchObject({ role: "customer", workspace_id: ws.workspaceId });

  // Signed in: one workspace per person, so the link isn't for them.
  await page.goto(`/join/${ws.joinToken}`);
  await expect(page.getByRole("heading", { name: "You already have an account" })).toBeVisible();
});

test("an admin invites an agent: one email, one use", async ({ browser }) => {
  const ws = await newWorkspace("Pied Piper Support");
  const adminContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const adminPage = await adminContext.newPage();
  await login(adminPage, ws.email, ws.password);
  await adminPage.goto("/admin/workspace");

  // An address that already has an account can't be invited.
  await adminPage.getByLabel("Agent's email").fill(requireEnv("TEST_USER_EMAIL"));
  await adminPage.getByRole("button", { name: "Create invite" }).click();
  await expect(adminPage.getByText("That email already has an account.")).toBeVisible();

  const agentEmail = newEmail("agent");
  await adminPage.getByLabel("Agent's email").fill(agentEmail);
  await adminPage.getByRole("button", { name: "Create invite" }).click();
  await expect(adminPage.getByRole("status")).toContainText(`Invite for ${agentEmail} created.`);
  const inviteUrl = await adminPage.getByLabel("Invite link").inputValue();
  expect(inviteUrl).toMatch(/\/invite\/wi_[A-Za-z0-9_-]{43}$/);
  const invitePath = new URL(inviteUrl).pathname;

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto(invitePath);
  await expect(page.getByRole("heading", { name: "Join Pied Piper Support as an agent" })).toBeVisible();
  await expect(page.getByPlaceholder("Email")).toHaveValue(agentEmail);

  // Another address is refused before any account is made.
  await signUp(page, newEmail("wrong"));
  await expect(page.getByText("This invite is for a different email address.")).toBeVisible();

  await signUp(page, agentEmail);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible({ timeout: 15_000 });
  expect(await membership(agentEmail)).toMatchObject({ role: "agent", workspace_id: ws.workspaceId });
  await context.close();

  // Used up: the link no longer works, and the admin sees it as joined.
  const again = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const againPage = await again.newPage();
  await againPage.goto(invitePath);
  await expect(againPage.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
  await again.close();
  await adminPage.reload();
  await expect(adminPage.getByRole("list", { name: "Agent invites" }).getByRole("listitem").filter({ hasText: agentEmail })).toContainText(
    "Joined"
  );
  await adminContext.close();
});

test("a revoked invite and a replaced link stop working", async ({ browser, page }) => {
  const ws = await newWorkspace("Aviato Care");
  await login(page, ws.email, ws.password);
  await page.goto("/admin/workspace");

  const agentEmail = newEmail("revoked");
  await page.getByLabel("Agent's email").fill(agentEmail);
  await page.getByRole("button", { name: "Create invite" }).click();
  const invitePath = new URL(await page.getByLabel("Invite link").inputValue()).pathname;
  await page.getByRole("button", { name: `Revoke the invite for ${agentEmail}` }).click();
  await expect(page.getByRole("list", { name: "Agent invites" }).getByRole("listitem").filter({ hasText: agentEmail })).toContainText(
    "Revoked"
  );

  const oldJoin = await page.getByLabel("Customer sign-up link").inputValue();
  await page.getByRole("button", { name: "Make a new link…" }).click();
  await page.getByRole("button", { name: "Replace the link" }).click();
  await expect(page.getByLabel("Customer sign-up link")).not.toHaveValue(oldJoin);
  const newJoin = await page.getByLabel("Customer sign-up link").inputValue();

  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const v = await visitor.newPage();
  await v.goto(invitePath);
  await expect(v.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
  await v.goto(new URL(oldJoin).pathname);
  await expect(v.getByRole("heading", { name: "This link isn't valid" })).toBeVisible();
  await v.goto(new URL(newJoin).pathname);
  await expect(v.getByRole("heading", { name: "Get support from Aviato Care" })).toBeVisible();
  await visitor.close();
});

test("only admins open the Workspace page", async ({ page }) => {
  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.goto("/admin/workspace");
  await expect(page).toHaveURL(/\/403$/);
});

test("an admin alone in their workspace can delete their account, and the workspace goes too", async () => {
  const ws = await newWorkspace("Raviga Desk");
  const db = service();
  const { data: user } = await db.from("profiles").select("id").eq("email", ws.email).single();
  expect((await db.auth.admin.deleteUser(user!.id)).error).toBeNull();
  expect((await db.from("workspaces").select("id").eq("id", ws.workspaceId)).data).toEqual([]);
});
