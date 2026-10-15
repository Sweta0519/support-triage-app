import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { requireEnv } from "./helpers";

// SUP-53: personal access tokens for the MCP connector. Customer A (the
// default signed-in account) creates one on the Account page; it's shown
// once, stored only as a hash, resolvable by the service role, invisible to
// other users, and dead once revoked or expired.

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

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
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return { db, id: data.user!.id };
}

test("create a token on the Account page: shown once, stored as a hash, resolvable, then revoked", async ({ page }) => {
  const admin = service();
  const name = `E2E token ${Date.now()}`;
  await page.goto("/account");
  const panel = page.getByRole("region", { name: "Access tokens" });
  await panel.getByLabel("Name").fill(name);
  await panel.getByLabel("Expires after").selectOption("30");
  await panel.getByRole("button", { name: "Create token" }).click();

  const shown = panel.getByLabel("New access token");
  await expect(shown).toBeVisible();
  const token = await shown.inputValue();
  expect(token).toMatch(/^st_[A-Za-z0-9_-]{43}$/);

  // The setup with this token in it, ready to paste (SUP-66).
  const setup = panel.getByRole("tabpanel");
  await expect(setup).toContainText(`--header "Authorization: Bearer ${token}"`);
  await expect(setup).toContainText("/api/mcp");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await panel.getByRole("button", { name: /^Copy the Claude Code setup/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`Bearer ${token}`);
  await panel.getByRole("tab", { name: "Cursor" }).click();
  await expect(setup).toContainText(`"Authorization": "Bearer ${token}"`);
  // VS Code asks for it, and Codex reads it from the environment: never in their files.
  await panel.getByRole("tab", { name: "VS Code" }).click();
  await expect(setup).not.toContainText(token);
  await panel.getByRole("tab", { name: "Codex" }).click();
  await expect(setup).not.toContainText(token);
  await expect(panel).toContainText(`export SUPPORT_TRIAGE_TOKEN=${token}`);
  // Only the "Created" line is a live region, never the token or the setup.
  await expect(panel.getByRole("status").filter({ hasText: "Created" })).toBeVisible();
  await expect(panel.getByRole("status").filter({ hasText: token })).toHaveCount(0);

  // Done puts it all away.
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel.getByRole("tablist", { name: "AI tool" })).toHaveCount(0);
  await expect(panel.getByLabel("New access token")).toHaveCount(0);

  // Stored as its SHA-256 hash, with the visible prefix and a 30-day expiry.
  const { data: row } = await admin.from("access_tokens").select("id, owner_id, token_hash, prefix, expires_at").eq("name", name).single();
  expect(row!.token_hash).toBe(sha256(token));
  expect(row!.prefix).toBe(token.slice(0, 11));
  const days = (new Date(row!.expires_at!).getTime() - Date.now()) / 86_400_000;
  expect(days).toBeGreaterThan(29);
  expect(days).toBeLessThan(31);

  // The MCP endpoint's lookup finds the owner and records the use.
  const { data: owner } = await admin.rpc("resolve_access_token", { p_token_hash: sha256(token) });
  expect(owner).toBe(row!.owner_id);

  // Shown once: after a reload the secret is gone; the list shows the name,
  // its prefix and that it was used.
  await page.reload();
  await expect(page.getByLabel("New access token")).toHaveCount(0);
  await expect(page.getByRole("tablist", { name: "AI tool" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(token);
  const item = page.getByRole("list", { name: "Your access tokens" }).getByRole("listitem").filter({ hasText: name });
  await expect(item).toContainText(token.slice(0, 11));
  await expect(item).toContainText("last used");

  // Revoke (two steps); the token stops resolving.
  await item.getByRole("button", { name: "Revoke…" }).click();
  await item.getByRole("button", { name: `Revoke ${name}` }).click();
  await expect(item).toContainText("Revoked");
  expect((await admin.rpc("resolve_access_token", { p_token_hash: sha256(token) })).data).toBeNull();

  await admin.from("access_tokens").delete().eq("id", row!.id);
});

test("tokens are private to their owner, the hash is never readable, and only the service role resolves tokens", async () => {
  const admin = service();
  const a = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
  const b = await signedIn(requireEnv("TEST_USER_B_EMAIL"), requireEnv("TEST_USER_B_PASSWORD"));
  const name = `E2E private ${Date.now()}`;
  const { data: secret, error } = await a.db.rpc("create_access_token", { p_name: name, p_expires_in_days: 30 });
  expect(error).toBeNull();
  expect(secret).toMatch(/^st_[A-Za-z0-9_-]{43}$/);
  const { data: mine } = await admin.from("access_tokens").select("id, token_hash").eq("name", name).single();
  expect(mine!.token_hash).toBe(sha256(secret));

  // Tokens are only made by the database: nobody can insert one directly,
  // with a hash they chose, for themselves or for someone else.
  const weak = await a.db.from("access_tokens").insert({ owner_id: a.id, name: "weak", token_hash: sha256("password"), prefix: "st_passwor" });
  expect(weak.error).not.toBeNull();
  const forged = await b.db.from("access_tokens").insert({ owner_id: a.id, name: "forged", token_hash: sha256(`${secret}b`), prefix: "st_forged00" });
  expect(forged.error).not.toBeNull();
  // Only the lifetimes the Account page offers.
  expect((await a.db.rpc("create_access_token", { p_name: "odd", p_expires_in_days: 7 })).error?.message).toContain("invalid_lifetime");

  // Nor edit or delete one (revoking goes through revoke_access_token).
  await a.db.from("access_tokens").update({ expires_at: null, revoked_at: null }).eq("id", mine!.id);
  await a.db.from("access_tokens").delete().eq("id", mine!.id);
  const { data: still } = await admin.from("access_tokens").select("id, expires_at").eq("id", mine!.id).single();
  expect(still!.expires_at).not.toBeNull();

  // B can't see or revoke A's token.
  expect((await b.db.from("access_tokens").select("id").eq("id", mine!.id)).data).toEqual([]);
  expect((await b.db.rpc("revoke_access_token", { p_id: mine!.id })).data).toBe(false);

  // Not even the owner can read the hash, and users can't resolve tokens.
  expect((await a.db.from("access_tokens").select("token_hash").eq("id", mine!.id)).error).not.toBeNull();
  expect((await a.db.rpc("resolve_access_token", { p_token_hash: sha256(secret) })).error).not.toBeNull();

  // An expired token doesn't resolve.
  await admin.from("access_tokens").update({ created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), expires_at: new Date(Date.now() - 86_400_000).toISOString() }).eq("id", mine!.id);
  expect((await admin.rpc("resolve_access_token", { p_token_hash: sha256(secret) })).data).toBeNull();

  await admin.from("access_tokens").delete().eq("id", mine!.id);
});

test("signed-out callers can't create, revoke or resolve tokens", async () => {
  const anon = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expect((await anon.rpc("create_access_token", { p_name: "anon", p_expires_in_days: null })).error).not.toBeNull();
  expect((await anon.rpc("revoke_access_token", { p_id: crypto.randomUUID() })).error).not.toBeNull();
  expect((await anon.rpc("resolve_access_token", { p_token_hash: sha256("st_anything") })).error).not.toBeNull();
});

test("at most 10 active tokens: the eleventh is refused until one is revoked", async () => {
  const admin = service();
  const b = await signedIn(requireEnv("TEST_USER_B_EMAIL"), requireEnv("TEST_USER_B_PASSWORD"));
  const tag = `E2E cap ${Date.now()}`;
  // Fill B's quota with service-role rows (no rate limit), then ask as B.
  const { count } = await admin.from("access_tokens").select("id", { count: "exact", head: true }).eq("owner_id", b.id).is("revoked_at", null);
  const rows = Array.from({ length: Math.max(0, 10 - (count ?? 0)) }, (_, i) => ({
    owner_id: b.id,
    name: `${tag} ${i}`,
    token_hash: sha256(`${tag} ${i}`),
    prefix: "st_capcap00",
  }));
  try {
    if (rows.length) expect((await admin.from("access_tokens").insert(rows)).error).toBeNull();
    expect((await b.db.rpc("create_access_token", { p_name: `${tag} over`, p_expires_in_days: 30 })).error?.message).toContain("too_many_tokens");

    const { data: one } = await admin.from("access_tokens").select("id").like("name", `${tag}%`).limit(1).single();
    expect((await b.db.rpc("revoke_access_token", { p_id: one!.id })).data).toBe(true);
    expect((await b.db.rpc("create_access_token", { p_name: `${tag} after`, p_expires_in_days: 30 })).error).toBeNull();
  } finally {
    await admin.from("access_tokens").delete().like("name", `${tag}%`);
  }
});

test("the data export lists your tokens without their hashes", async ({ page }) => {
  const name = `E2E export ${Date.now()}`;
  const a = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
  const { data: secret } = await a.db.rpc("create_access_token", { p_name: name, p_expires_in_days: 30 });
  try {
    const res = await page.request.get("/account/export");
    expect(res.ok()).toBe(true);
    const text = await res.text();
    const exported = JSON.parse(text) as { access_tokens: { name: string; prefix: string }[] };
    expect(exported.access_tokens.find((t) => t.name === name)?.prefix).toBe(secret!.slice(0, 11));
    expect(text).not.toContain("token_hash");
    expect(text).not.toContain(sha256(secret!));
    expect(text).not.toContain(secret!);
  } finally {
    await service().from("access_tokens").delete().eq("name", name);
  }
});
