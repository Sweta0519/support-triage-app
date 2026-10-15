import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { requireEnv } from "./helpers";

// SUP-54: the MCP endpoint. Requests sign in with a personal access token
// (never a cookie), run as its owner, and see that owner's role as it is in
// the database right now.

const ENDPOINT = "/api/mcp";
const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

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

// A confirmed throwaway account (so no shared test account's role or tokens
// change), with a token of its own.
async function throwawayWithToken() {
  const admin = service();
  const email = `sup54-mcp-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  const remove = () => admin.auth.admin.deleteUser(data.user!.id);
  try {
    const user = await signedIn(email, password);
    expect((await user.db.rpc("ensure_profile")).error).toBeNull();
    const { data: token, error: tokenError } = await user.db.rpc("create_access_token", { p_name: "E2E MCP", p_expires_in_days: 30 });
    expect(tokenError).toBeNull();
    return { id: data.user!.id, email, db: user.db, token: token as string, remove };
  } catch (err) {
    await remove();
    throw err;
  }
}

function rpc(method: string, params: Record<string, unknown> = {}) {
  return JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
}

test("no token, a malformed token, or an unknown one gets 401", async ({ request }) => {
  for (const authorization of [undefined, "Bearer", "Basic abc", "Bearer not-a-token", `Bearer st_${"A".repeat(43)}`]) {
    const res = await request.post(ENDPOINT, {
      headers: authorization ? { ...HEADERS, authorization } : HEADERS,
      data: rpc("tools/list"),
    });
    expect(res.status(), String(authorization)).toBe(401);
    expect(res.headers()["www-authenticate"]).toContain("Bearer");
  }
});

test("a web session cookie alone doesn't sign in", async ({ page }) => {
  // The default project is signed in as customer A; the endpoint ignores it.
  await page.goto("/account");
  const res = await page.request.post(ENDPOINT, { headers: HEADERS, data: rpc("tools/list") });
  expect(res.status()).toBe(401);
});

test("no CORS: another site's page can't send a token here", async ({ request }) => {
  const preflight = await request.fetch(ENDPOINT, {
    method: "OPTIONS",
    headers: { origin: "https://elsewhere.example", "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
  });
  expect(Object.keys(preflight.headers()).filter((h) => h.startsWith("access-control-"))).toEqual([]);
});

test("a token signs in as its owner: initialize, list tools, whoami; revoked, it stops working", async ({ request }) => {
  const user = await throwawayWithToken();
  try {
    const call = (method: string, params?: Record<string, unknown>) =>
      request.post(ENDPOINT, { headers: { ...HEADERS, authorization: `Bearer ${user.token}` }, data: rpc(method, params) });

    const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "0" } });
    expect(init.status()).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("support-triage");

    const list = await call("tools/list");
    expect((await list.json()).result.tools.map((t: { name: string }) => t.name)).toContain("whoami");

    const who = await call("tools/call", { name: "whoami", arguments: {} });
    expect(JSON.parse((await who.json()).result.content[0].text)).toEqual({ name: user.email, email: user.email, role: "customer" });

    // The use was recorded on the token.
    const { data: row } = await service().from("access_tokens").select("id, last_used_at").eq("owner_id", user.id).single();
    expect(row!.last_used_at).not.toBeNull();

    // Not stateful: no stream to open, no session to end.
    expect((await request.get(ENDPOINT, { headers: { authorization: `Bearer ${user.token}` } })).status()).toBe(405);
    expect((await request.delete(ENDPOINT, { headers: { authorization: `Bearer ${user.token}` } })).status()).toBe(405);

    // Bodies over 256 KB are refused before they're parsed.
    const big = await request.post(ENDPOINT, {
      headers: { ...HEADERS, authorization: `Bearer ${user.token}` },
      data: rpc("tools/list", { padding: "x".repeat(300 * 1024) }),
    });
    expect(big.status()).toBe(413);

    // Revoked by its owner, as on the Account page: the next request is refused.
    expect((await user.db.rpc("revoke_access_token", { p_id: row!.id })).data).toBe(true);
    expect((await call("tools/list")).status()).toBe(401);
  } finally {
    await user.remove();
  }
});

test("the role is read on every request: a promoted, then demoted, user sees each change on the next call", async ({ request }) => {
  const user = await throwawayWithToken();
  const admin = await signedIn(requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  try {
    const whoami = async () => {
      const res = await request.post(ENDPOINT, {
        headers: { ...HEADERS, authorization: `Bearer ${user.token}` },
        data: rpc("tools/call", { name: "whoami", arguments: {} }),
      });
      expect(res.status()).toBe(200);
      return JSON.parse((await res.json()).result.content[0].text).role;
    };
    expect(await whoami()).toBe("customer");
    expect((await admin.db.rpc("admin_set_role", { target_user_id: user.id, new_role: "agent" })).error).toBeNull();
    expect(await whoami()).toBe("agent");
    expect((await admin.db.rpc("admin_set_role", { target_user_id: user.id, new_role: "customer" })).error).toBeNull();
    expect(await whoami()).toBe("customer");
  } finally {
    await user.remove();
  }
});

test("an expired token stops working", async ({ request }) => {
  const user = await throwawayWithToken();
  try {
    const call = () => request.post(ENDPOINT, { headers: { ...HEADERS, authorization: `Bearer ${user.token}` }, data: rpc("tools/list") });
    expect((await call()).status()).toBe(200);
    await service()
      .from("access_tokens")
      .update({ created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(), expires_at: new Date(Date.now() - 86_400_000).toISOString() })
      .eq("owner_id", user.id);
    expect((await call()).status()).toBe(401);
  } finally {
    await user.remove();
  }
});

test("a deleted account's token stops working", async ({ request }) => {
  const user = await throwawayWithToken();
  let removed = false;
  try {
    const call = () => request.post(ENDPOINT, { headers: { ...HEADERS, authorization: `Bearer ${user.token}` }, data: rpc("tools/list") });
    expect((await call()).status()).toBe(200);
    await user.remove();
    removed = true;
    expect((await call()).status()).toBe(401);
  } finally {
    if (!removed) await user.remove();
  }
});

test("two people's tokens each act as their own owner, even when used at once", async ({ request }) => {
  const [one, two] = await Promise.all([throwawayWithToken(), throwawayWithToken()]);
  try {
    const whoami = async (token: string) => {
      const res = await request.post(ENDPOINT, {
        headers: { ...HEADERS, authorization: `Bearer ${token}` },
        data: rpc("tools/call", { name: "whoami", arguments: {} }),
      });
      expect(res.status()).toBe(200);
      return JSON.parse((await res.json()).result.content[0].text).email;
    };
    // Interleaved first calls (both sign-ins in flight together), then cached ones.
    for (let round = 0; round < 2; round++) {
      const results = await Promise.all([whoami(one.token), whoami(two.token), whoami(one.token), whoami(two.token)]);
      expect(results).toEqual([one.email, two.email, one.email, two.email]);
    }
  } finally {
    await Promise.all([one.remove(), two.remove()]);
  }
});

test("requests are rate limited per person", async ({ request }) => {
  const user = await throwawayWithToken();
  try {
    // Fill the budget (120 per 10 minutes) directly: this window and the next,
    // in case the request lands after a boundary or the clocks disagree.
    const window = Math.floor(Date.now() / 600_000) * 600_000;
    const rows = [window - 600_000, window, window + 600_000].map((t) => ({
      key: `${user.id}:mcp_request`,
      window_start: new Date(t).toISOString(),
      count: 120,
    }));
    expect((await service().from("rate_limits").upsert(rows)).error).toBeNull();
    const res = await request.post(ENDPOINT, { headers: { ...HEADERS, authorization: `Bearer ${user.token}` }, data: rpc("tools/list") });
    expect(res.status()).toBe(429);
    expect(res.headers()["retry-after"]).toBeTruthy();
  } finally {
    await service().from("rate_limits").delete().like("key", `${user.id}:%`);
    await user.remove();
  }
});
