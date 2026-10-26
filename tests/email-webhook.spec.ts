import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { requireEnv } from "./helpers";
import { service } from "./mcp-helpers";

// SUP-88: Resend's inbound email webhook. Only a delivery signed with the
// webhook secret, within 5 minutes, gets in; each svix-id is recorded once;
// the workspace comes from the recipient address alone. Two throwaway
// workspaces (no members) are made with the service role and deleted after.

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

const ENDPOINT = "/api/email/inbound";
const RUN = `${Date.now()}-${randomUUID().slice(0, 6)}`;

type Ws = { id: string; address: string };
let a: Ws;
let b: Ws;

function secret() {
  return requireEnv("RESEND_WEBHOOK_SECRET");
}
function domain() {
  return requireEnv("EMAIL_INBOUND_DOMAIN").toLowerCase();
}

function sign(id: string, timestamp: number, body: string, key = secret()) {
  const raw = Buffer.from(key.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", raw).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

function event(to: string[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "email.received",
    created_at: new Date().toISOString(),
    data: { email_id: randomUUID(), from: "Customer <customer@example.com>", to, subject: "Help", ...extra },
  });
}

type Options = { id?: string; timestamp?: number; signature?: string | null };

function deliver(request: import("@playwright/test").APIRequestContext, body: string, opts: Options = {}) {
  const id = opts.id ?? `msg_${RUN}_${randomUUID()}`;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = opts.signature === undefined ? sign(id, timestamp, body) : opts.signature;
  const headers: Record<string, string> = { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(timestamp) };
  if (signature !== null) headers["svix-signature"] = signature;
  return { id, response: request.post(ENDPOINT, { headers, data: body }) };
}

async function recorded(svixId: string) {
  const { data } = await service().from("inbound_email_events").select("workspace_id, status, reason").eq("svix_id", svixId);
  return data ?? [];
}

test.beforeAll(async () => {
  const make = async (tag: string): Promise<Ws> => {
    const { data, error } = await service()
      .from("workspaces")
      .insert({ name: `Email ${tag} ${RUN}` })
      .select("id, inbound_address")
      .single();
    expect(error).toBeNull();
    return { id: data!.id, address: `${data!.inbound_address}@${domain()}` };
  };
  [a, b] = await Promise.all([make("A"), make("B")]);
});

test.afterAll(async () => {
  // Events go with their workspace (on delete cascade).
  await service().from("workspaces").delete().in("id", [a?.id, b?.id].filter(Boolean));
  await service().from("inbound_email_events").delete().like("svix_id", `msg_${RUN}_%`);
  await service().from("rate_limits").delete().in("key", [`email_inbound:${a?.id}`, `email_inbound:${b?.id}`]);
});

test("unsigned, forged, wrong-secret, stale and future-dated deliveries get 401 and record nothing", async ({ request }) => {
  const body = event([a.address]);
  const now = Math.floor(Date.now() / 1000);
  const otherSecret = `whsec_${randomBytes(24).toString("base64")}`;
  const cases: [string, Options][] = [
    ["no signature", { signature: null }],
    ["garbage signature", { signature: "v1,bm90LWEtc2lnbmF0dXJl" }],
    ["wrong version", { signature: sign("x", now, body).replace("v1,", "v2,") }],
    ["other secret", { timestamp: now, signature: sign(`msg_${RUN}_other`, now, body, otherSecret), id: `msg_${RUN}_other` }],
    ["stale", { timestamp: now - 6 * 60 }],
    ["future", { timestamp: now + 6 * 60 }],
  ];
  for (const [name, opts] of cases) {
    const { id, response } = deliver(request, body, opts);
    expect((await response).status(), name).toBe(401);
    expect(await recorded(id), name).toEqual([]);
  }

  // A valid signature for a different body (tampered in transit).
  const id = `msg_${RUN}_tampered`;
  const res = await request.post(ENDPOINT, {
    headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(now), "svix-signature": sign(id, now, body) },
    data: event([b.address]),
  });
  expect(res.status()).toBe(401);
  expect(await recorded(id)).toEqual([]);
});

test("a signed delivery is recorded once for its workspace; the retry is a duplicate", async ({ request }) => {
  const body = event([`Support <${a.address.toUpperCase()}>`]);
  const first = deliver(request, body);
  const res = await first.response;
  expect(res.status()).toBe(200);
  expect((await res.json()).message).toBe("received");
  expect(await recorded(first.id)).toEqual([{ workspace_id: a.id, status: "received", reason: null }]);

  // Resend retries with the same svix-id (and a fresh timestamp and signature).
  const retry = deliver(request, body, { id: first.id });
  expect((await (await retry.response).json()).message).toBe("duplicate");
  expect(await recorded(first.id)).toHaveLength(1);
});

test("the envelope recipient counts when To is the team's own address (a forward)", async ({ request }) => {
  const { id, response } = deliver(request, event(["support@customer-company.example"], { received_for: [b.address] }));
  expect((await (await response).json()).message).toBe("received");
  expect(await recorded(id)).toEqual([{ workspace_id: b.id, status: "received", reason: null }]);
});

test("unknown addresses, other domains, and two workspaces at once are ignored", async ({ request }) => {
  const [local] = a.address.split("@");
  const cases: [string[], string][] = [
    [[`in-000000000000@${domain()}`], "unknown_address"],
    [[`${local}@elsewhere.example`], "unknown_address"],
    [[a.address, b.address], "ambiguous_address"],
  ];
  for (const [to, reason] of cases) {
    const { id, response } = deliver(request, event(to));
    expect((await (await response).json()).message, reason).toBe("ignored");
    expect(await recorded(id), reason).toEqual([{ workspace_id: null, status: "ignored", reason }]);
  }
});

test("a signed event of another type is acknowledged and not recorded", async ({ request }) => {
  const { id, response } = deliver(request, JSON.stringify({ type: "email.sent", data: { email_id: randomUUID() } }));
  const res = await response;
  expect(res.status()).toBe(200);
  expect(await recorded(id)).toEqual([]);
});

test("no CORS, no cookies needed, and GET isn't served", async ({ request }) => {
  const preflight = await request.fetch(ENDPOINT, {
    method: "OPTIONS",
    headers: { origin: "https://elsewhere.example", "access-control-request-method": "POST" },
  });
  expect(Object.keys(preflight.headers()).filter((h) => h.startsWith("access-control-"))).toEqual([]);
  expect((await request.get(ENDPOINT)).status()).toBe(405);
});
