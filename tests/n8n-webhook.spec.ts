import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";
import Module from "node:module";
import path from "node:path";

import type { WebhookEvent } from "../app/lib/webhooks/n8n";

// SUP-94: the signed outbound webhook to n8n. Pure functions plus sendWebhook
// with an injected fetch stub: no browser, no network, no database.

type N8n = typeof import("../app/lib/webhooks/n8n");
let n8n: N8n;

// n8n.ts (and db/webhooks.ts) start with `import "server-only"`. Next replaces
// that with an empty module at build time; plain Node has no such package, and
// the one in next/dist/compiled throws. Point the bare specifier at Next's empty
// module, for this spec's worker only, then load n8n.ts after the patch.
test.beforeAll(async () => {
  const emptyServerOnly = path.join(path.dirname(require.resolve("next/package.json")), "dist/compiled/server-only/empty.js");
  const hooked = Module as unknown as { _resolveFilename: (request: string, ...rest: unknown[]) => string };
  const original = hooked._resolveFilename;
  hooked._resolveFilename = function (request: string, ...rest: unknown[]) {
    return original.call(this, request === "server-only" ? emptyServerOnly : request, ...rest);
  };
  n8n = await import("../app/lib/webhooks/n8n");
});

const ENV_KEYS = ["N8N_WEBHOOK_URL", "N8N_WEBHOOK_SECRET", "NEXT_PUBLIC_SITE_URL"] as const;
const saved: Record<string, string | undefined> = {};

test.beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});

test.afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const SECRET = "whsec_test";
const TICKET_ID = "7f1c2a3e-4b5d-4e6f-8a9b-0c1d2e3f4a5b";
const WORKSPACE_ID = "9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d";

const source = {
  priority: "urgent",
  priority_reason: "Customer reports payment failure on a live order.",
  team: "billing",
  category: "billing",
  is_escalation_risk: true,
  summary: "Customer was charged twice and is threatening to cancel.",
} as unknown as Parameters<typeof buildEscalationPayload>[3];

function configure(url: string | null = "https://n8n.example.com/webhook/x", secret: string | null = SECRET) {
  if (url === null) delete process.env.N8N_WEBHOOK_URL;
  else process.env.N8N_WEBHOOK_URL = url;
  if (secret === null) delete process.env.N8N_WEBHOOK_SECRET;
  else process.env.N8N_WEBHOOK_SECRET = secret;
}

type Call = { url: URL; init: RequestInit };

function stubFetch(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: URL, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function sampleEvent(): WebhookEvent {
  return n8n.buildEscalationPayload("evt_1", TICKET_ID, WORKSPACE_ID, source);
}

test("signWebhook matches an independent HMAC-SHA256 of timestamp.body", () => {
  const timestamp = "1717000000";
  const body = JSON.stringify({ id: "evt_42", type: "ticket.escalation_flagged" });
  const expected = "sha256=" + createHmac("sha256", "s3cret").update(`${timestamp}.${body}`).digest("hex");
  expect(n8n.signWebhook("s3cret", timestamp, body)).toBe(expected);
  expect(n8n.signWebhook("s3cret", Number(timestamp), body)).toBe(expected);
});

test("signWebhook matches a pinned hex vector", () => {
  expect(n8n.signWebhook("whsec_test", 1700000000, '{"id":"e1"}')).toBe(
    "sha256=6a85cb117c993612a34c72b4cfb5a16baed25a80d26e298ce0e6671320fd07c8",
  );
});

test("signWebhook changes when the secret, timestamp or body changes", () => {
  const base = n8n.signWebhook("a", "1", "{}");
  expect(n8n.signWebhook("b", "1", "{}")).not.toBe(base);
  expect(n8n.signWebhook("a", "2", "{}")).not.toBe(base);
  expect(n8n.signWebhook("a", "1", "{ }")).not.toBe(base);
});

test("buildEscalationPayload has exactly the envelope keys and the allow-listed data keys", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://support.example.com";
  const ev = n8n.buildEscalationPayload("evt_1", TICKET_ID, WORKSPACE_ID, {
    ...source,
    subject: "Charged twice",
    body: "My card was charged twice. Please help.",
    description: "full text",
    email: "customer@example.com",
    customer_name: "Jane Roe",
  } as unknown as Parameters<typeof buildEscalationPayload>[3]);

  expect(Object.keys(ev).sort()).toEqual(["created_at", "data", "id", "type"]);
  expect(ev.id).toBe("evt_1");
  expect(ev.type).toBe("ticket.escalation_flagged");
  expect(Number.isNaN(Date.parse(ev.created_at))).toBe(false);

  expect(Object.keys(ev.data).sort()).toEqual(
    [
      "category",
      "is_escalation_risk",
      "link",
      "priority",
      "priority_reason",
      "summary",
      "team",
      "ticket_id",
      "workspace_id",
    ].sort(),
  );
  // None of the extra input fields leak into the payload.
  const serialized = JSON.stringify(ev);
  for (const leaked of ["Charged twice", "full text", "customer@example.com", "Jane Roe", "Please help"]) {
    expect(serialized, leaked).not.toContain(leaked);
  }
});

test("buildEscalationPayload builds the link from NEXT_PUBLIC_SITE_URL without a trailing slash", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://support.example.com/";
  expect(n8n.buildEscalationPayload("e", TICKET_ID, WORKSPACE_ID, source).data.link).toBe(
    `https://support.example.com/tickets/${TICKET_ID}`,
  );
  process.env.NEXT_PUBLIC_SITE_URL = "https://support.example.com///";
  expect(n8n.buildEscalationPayload("e", TICKET_ID, WORKSPACE_ID, source).data.link).toBe(
    `https://support.example.com/tickets/${TICKET_ID}`,
  );
});

test("buildEscalationPayload passes the triage fields through unchanged", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://support.example.com";
  const { data } = n8n.buildEscalationPayload("e", TICKET_ID, WORKSPACE_ID, source);
  expect(data.ticket_id).toBe(TICKET_ID);
  expect(data.workspace_id).toBe(WORKSPACE_ID);
  expect(data.priority).toBe("urgent");
  expect(data.team).toBe("billing");
  expect(data.category).toBe("billing");
  expect(data.is_escalation_risk).toBe(true);
});

test("an email, phone number and URL in summary and priority_reason become [removed]", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://support.example.com";
  const dirty = {
    ...source,
    summary: "Mail jane.roe@acme.com or call +44 20 7946 0958 about https://acme.example/invoice",
    priority_reason: "Escalated: see www.acme.example, phone (030) 123 4567",
  } as unknown as Parameters<typeof buildEscalationPayload>[3];
  const { data } = n8n.buildEscalationPayload("e", TICKET_ID, WORKSPACE_ID, dirty);

  expect(data.summary).toBe("Mail [removed] or call [removed] about [removed]");
  expect(data.priority_reason).toBe("Escalated: see [removed] phone [removed]");
  for (const leaked of ["jane.roe@acme.com", "7946", "acme.example", "4567"]) {
    expect(JSON.stringify(data), leaked).not.toContain(leaked);
  }
});

test("dates and times survive the scrub in summary", () => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://support.example.com";
  const { data } = n8n.buildEscalationPayload(
    "e",
    TICKET_ID,
    WORKSPACE_ID,
    { ...source, summary: "Outage since 2026-10-13 14:00." } as unknown as Parameters<typeof buildEscalationPayload>[3],
  );
  expect(data.summary).toBe("Outage since 2026-10-13 14:00.");
});

test("sendWebhook is skipped when N8N_WEBHOOK_URL is unset and never calls fetch", async () => {
  configure(null, SECRET);
  const { fetchImpl, calls } = stubFetch(() => new Response("ok", { status: 200 }));
  expect(await n8n.sendWebhook(sampleEvent(), { fetchImpl })).toBe("skipped");
  expect(calls.length).toBe(0);
});

test("sendWebhook is skipped when N8N_WEBHOOK_SECRET is unset and never calls fetch", async () => {
  configure("https://n8n.example.com/webhook/x", null);
  const { fetchImpl, calls } = stubFetch(() => new Response("ok", { status: 200 }));
  expect(await n8n.sendWebhook(sampleEvent(), { fetchImpl })).toBe("skipped");
  expect(calls.length).toBe(0);
});

test("sendWebhook POSTs a signed request and returns sent on 200", async () => {
  configure("https://n8n.example.com/webhook/x", SECRET);
  process.env.NEXT_PUBLIC_SITE_URL = "https://support.example.com";
  const event = sampleEvent();
  const { fetchImpl, calls } = stubFetch(() => new Response("ok", { status: 200 }));

  expect(await n8n.sendWebhook(event, { fetchImpl })).toBe("sent");
  expect(calls.length).toBe(1);

  const { url, init } = calls[0];
  expect(url.toString()).toBe("https://n8n.example.com/webhook/x");
  expect(init.method).toBe("POST");
  expect(init.redirect).toBe("manual");

  const headers = init.headers as Record<string, string>;
  expect(headers["Content-Type"]).toBe("application/json");
  expect(headers["X-Event-Id"]).toBe(event.id);

  const body = init.body as string;
  expect(body).toBe(JSON.stringify(event));

  // The signature verifies against the exact body and timestamp sent.
  const timestamp = headers["X-Timestamp"];
  expect(timestamp).toMatch(/^\d+$/);
  const now = Math.floor(Date.now() / 1000);
  expect(Math.abs(Number(timestamp) - now)).toBeLessThan(60);
  const expected = "sha256=" + createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex");
  expect(headers["X-Signature"]).toBe(expected);
});

test("sendWebhook returns failed on a 302 redirect", async () => {
  configure("https://n8n.example.com/webhook/x", SECRET);
  const { fetchImpl } = stubFetch(() => new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }));
  expect(await n8n.sendWebhook(sampleEvent(), { fetchImpl })).toBe("failed");
});

test("sendWebhook returns failed on a 500", async () => {
  configure("https://n8n.example.com/webhook/x", SECRET);
  const { fetchImpl } = stubFetch(() => new Response("boom", { status: 500 }));
  expect(await n8n.sendWebhook(sampleEvent(), { fetchImpl })).toBe("failed");
});

test("sendWebhook returns failed when fetch rejects, without throwing", async () => {
  configure("https://n8n.example.com/webhook/x", SECRET);
  const fetchImpl = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  await expect(n8n.sendWebhook(sampleEvent(), { fetchImpl })).resolves.toBe("failed");
});

test("sendWebhook returns failed within about 3.5 s when fetch never resolves but honours the abort signal", async () => {
  configure("https://n8n.example.com/webhook/x", SECRET);
  const fetchImpl = ((_url: URL, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    })) as unknown as typeof fetch;

  const started = Date.now();
  const result = await n8n.sendWebhook(sampleEvent(), { fetchImpl });
  const elapsed = Date.now() - started;
  expect(result).toBe("failed");
  expect(elapsed).toBeLessThan(3500);
});

test("assertWebhookUrl rejects non-https schemes and URLs with credentials", () => {
  for (const bad of [
    "ftp://n8n.example.com/webhook/x",
    "file:///etc/passwd",
    "http://example.com/webhook/x",
    "https://u:p@host.example/webhook/x",
  ]) {
    expect(() => n8n.assertWebhookUrl(bad), bad).toThrow();
  }
});

test("assertWebhookUrl accepts https URLs and plain http only for localhost", () => {
  expect(n8n.assertWebhookUrl("https://n8n.example.com/webhook/x").hostname).toBe("n8n.example.com");
  expect(n8n.assertWebhookUrl("http://localhost:5678/webhook/x").hostname).toBe("localhost");
  expect(n8n.assertWebhookUrl("http://127.0.0.1:5678").hostname).toBe("127.0.0.1");
});
