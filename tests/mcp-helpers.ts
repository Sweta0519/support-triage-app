import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { requireEnv } from "./helpers";

// Shared by the MCP specs (SUP-54, SUP-55).

export const ENDPOINT = "/api/mcp";
export const HEADERS = { "content-type": "application/json", accept: "application/json, text/event-stream" };

export function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// A confirmed throwaway account (so no shared test account's role or tokens
// change), with a token of its own. Made entirely with the service role:
// no password sign-in, which Supabase rate-limits across the whole suite.
// (Creating tokens through create_access_token() is tested in
// access-tokens.spec.ts.) Sign-up metadata picks the workspace as the form
// does (SUP-82): none joins the default one as a customer.
export async function throwawayWithToken(tag = "mcp", userMetadata?: Record<string, string>) {
  const admin = service();
  const email = `e2e-${tag}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: userMetadata });
  expect(error).toBeNull();
  const id = data.user!.id;
  const remove = () => admin.auth.admin.deleteUser(id);
  try {
    const token = `st_${randomBytes(32).toString("base64url")}`;
    const { error: tokenError } = await admin.from("access_tokens").insert({
      owner_id: id,
      name: "E2E MCP",
      token_hash: createHash("sha256").update(token).digest("hex"),
      prefix: token.slice(0, 11),
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(tokenError).toBeNull();
    return { id, email, password, token, remove };
  } catch (err) {
    await remove();
    throw err;
  }
}

// Sets a throwaway account's role directly (service role), as admin_set_role
// would. The role is the workspace membership's (SUP-81).
export async function setRole(userId: string, role: "customer" | "agent" | "admin") {
  expect((await service().from("workspace_members").update({ role }).eq("user_id", userId)).error).toBeNull();
}

// Calls one MCP tool with a token. Returns the parsed JSON result, or the
// error text when the tool refused (isError).
export async function callTool(request: APIRequestContext, token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await request.post(ENDPOINT, {
    headers: { ...HEADERS, authorization: `Bearer ${token}` },
    data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.error, JSON.stringify(body.error)).toBeUndefined();
  const text: string = body.result.content[0].text;
  return body.result.isError ? { error: text } : { data: JSON.parse(text) };
}

export async function listTools(request: APIRequestContext, token: string): Promise<string[]> {
  const res = await request.post(ENDPOINT, {
    headers: { ...HEADERS, authorization: `Bearer ${token}` },
    data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  expect(res.status()).toBe(200);
  return (await res.json()).result.tools.map((t: { name: string }) => t.name);
}
