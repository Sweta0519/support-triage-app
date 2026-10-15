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
  const secret = `st_${"x".repeat(43)}${Date.now()}`;
  const { data: mine, error } = await a.db
    .from("access_tokens")
    .insert({ owner_id: a.id, name: `E2E private ${Date.now()}`, token_hash: sha256(secret), prefix: secret.slice(0, 11) })
    .select("id")
    .single();
  expect(error).toBeNull();

  // Nobody can create a token for someone else.
  const forged = await b.db.from("access_tokens").insert({ owner_id: a.id, name: "forged", token_hash: sha256(`${secret}b`), prefix: "st_forged00" });
  expect(forged.error).not.toBeNull();

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
