import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import {
  INCIDENT_MIN_TICKETS,
  INCIDENT_SIMILARITY,
  INCIDENT_WINDOW_MINUTES,
  sanitizeIncidentText,
  summarizeIncidents,
} from "../app/lib/incidents";
import { login, requireEnv } from "./helpers";

// SUP-42: a burst of similar tickets is grouped into one incident. These
// seed tickets with controlled embeddings (so "similar" and "unrelated" are
// exact, with no model call) and run detection through the same RPC the
// background uses. Runs in its own last Playwright project: an open incident
// puts a banner on every staff page.

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Deterministic unit vectors: `similar(base)` is ~0.99 cosine to base, two
// different bases are ~0.
function randomUnit(seed: number): number[] {
  // mulberry32: exact 32-bit integer maths, so different seeds really give
  // independent vectors (a float LCG loses precision and repeats).
  let x = seed >>> 0;
  const next = () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = Math.imul(x ^ (x >>> 15), 1 | x);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const v = Array.from({ length: 1536 }, () => next() - 0.5);
  const n = Math.hypot(...v);
  return v.map((a) => a / n);
}
function similar(base: number[], seed: number): number[] {
  const noise = randomUnit(seed);
  const v = base.map((a, i) => a + 0.3 * noise[i]);
  const n = Math.hypot(...v);
  return v.map((a) => a / n);
}

const created: string[] = [];
const stamp = Date.now();

// Bursts alternate between the two test customers: an incident needs at
// least two different customers.
let seeded = 0;
async function seed(subject: string, embedding: number[], { minutesAgo = 0, customerEmail = "" } = {}) {
  const db = service();
  const email = customerEmail || requireEnv(seeded++ % 2 ? "TEST_USER_B_EMAIL" : "TEST_USER_EMAIL");
  const { data: customer } = await db.from("profiles").select("id").eq("email", email).single();
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: customer!.id, subject: `${subject} ${stamp}`, body: "Incident probe body" })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  created.push(ticket.id);
  if (minutesAgo) {
    const at = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const { error: e } = await db.from("tickets").update({ created_at: at }).eq("id", ticket.id);
    if (e) throw new Error(e.message);
  }
  const { error: embError } = await db
    .from("ticket_embeddings")
    .insert({ ticket_id: ticket.id, embedding: `[${embedding.join(",")}]`, embedding_model: "test" });
  if (embError) throw new Error(embError.message);
  return ticket as { id: string; number: number };
}

async function detect(ticketId: string) {
  const { data, error } = await service().rpc("detect_incident", {
    p_ticket_id: ticketId,
    p_threshold: INCIDENT_SIMILARITY,
    p_window_minutes: INCIDENT_WINDOW_MINUTES,
    p_min_tickets: INCIDENT_MIN_TICKETS,
  });
  if (error) throw new Error(error.message);
  return (data as { incident_id: string; created: boolean; ticket_count: number; status: string }[])[0] ?? null;
}

test.afterAll(async () => {
  // Deleting the tickets deletes their (now empty) incidents too.
  if (created.length) await service().from("tickets").delete().in("id", created);
});

test("the incident text keeps nothing customer-specific, but keeps dates and times; analytics counts", () => {
  expect(sanitizeIncidentText("Hi! See https://x.io/a or mail ops@example.com about order ORD-48213 / 123456. Thanks")).toBe(
    "Hi! See [removed] or mail [removed] about order [removed] / [removed]. Thanks"
  );
  // Phones in any format, reference codes, amounts.
  expect(sanitizeIncidentText("Call +1 555 123 4567, (555) 123-4567 or +49 151 2345 678. Ref INV 20431, refund $49.99 or 30 EUR")).toBe(
    "Call [removed], [removed] or [removed]. Ref [removed], refund [removed] or [removed]"
  );
  // The incident's own when: kept.
  expect(sanitizeIncidentText("Since 2026-10-13 at 14:00 (all of 2026's webhooks), 3 tickets")).toBe(
    "Since 2026-10-13 at 14:00 (all of 2026's webhooks), 3 tickets"
  );
  const s = summarizeIncidents([
    { status: "open", first_seen_at: "2026-10-13T10:00:00Z", opened_at: "2026-10-13T10:10:00Z" },
    { status: "resolved", first_seen_at: "2026-10-13T10:00:00Z", opened_at: "2026-10-13T10:30:00Z" },
    { status: "dismissed", first_seen_at: "2026-10-13T10:00:00Z", opened_at: "2026-10-13T10:20:00Z" },
  ]);
  expect(s).toEqual({ total: 3, open: 1, resolved: 1, dismissed: 1, medianDetectionMs: 20 * 60_000 });
});

test("a burst of similar tickets opens one incident; later ones join; unrelated and old ones don't", async () => {
  const base = randomUnit(11);
  const a = await seed("Incident probe A", similar(base, 1));
  const b = await seed("Incident probe B", similar(base, 2));
  expect(await detect(a.id)).toBeNull();
  expect(await detect(b.id)).toBeNull(); // only 2 so far
  const c = await seed("Incident probe C", similar(base, 3));
  const opened = await detect(c.id);
  expect(opened).toMatchObject({ created: true, ticket_count: 3, status: "open" });
  const d = await seed("Incident probe D", similar(base, 4));
  expect(await detect(d.id)).toEqual({ incident_id: opened!.incident_id, created: false, ticket_count: 4, status: "open" });
  // Unrelated: no incident.
  const e = await seed("Incident probe unrelated", randomUnit(99));
  expect(await detect(e.id)).toBeNull();
  // Similar to each other, but filed two hours apart from now: outside the window.
  const old = randomUnit(23);
  const o1 = await seed("Incident probe old 1", similar(old, 5), { minutesAgo: 130 });
  const o2 = await seed("Incident probe old 2", similar(old, 6), { minutesAgo: 125 });
  await seed("Incident probe old 3", similar(old, 7), { minutesAgo: 120 });
  const o4 = await seed("Incident probe old 4", similar(old, 8));
  expect(await detect(o4.id)).toBeNull();
  // ...and an old ticket re-triaged now doesn't join today's burst.
  expect(await detect(o1.id)).toBeNull();
  void o2;
  // Three look-alikes from one customer (follow-ups, duplicates): not an outage.
  const solo = randomUnit(57);
  const email = requireEnv("TEST_USER_EMAIL");
  for (let i = 0; i < 2; i++) await detect((await seed(`Incident probe solo ${i}`, similar(solo, 60 + i), { customerEmail: email })).id);
  expect(await detect((await seed("Incident probe solo 2", similar(solo, 62), { customerEmail: email })).id)).toBeNull();
});

test("customers can't read incidents, even for their own tickets", async () => {
  const customer = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await customer.auth.signInWithPassword({ email: requireEnv("TEST_USER_EMAIL"), password: requireEnv("TEST_USER_PASSWORD") });
  expect((await customer.from("incidents").select("id")).data ?? []).toEqual([]);
  expect((await customer.from("incident_tickets").select("ticket_id")).data ?? []).toEqual([]);
  // ...and can't run detection.
  expect((await customer.rpc("detect_incident", { p_ticket_id: created[0], p_threshold: 0, p_window_minutes: 60, p_min_tickets: 1 })).error).not.toBeNull();
});

test("staff see the banner and markers, post one update to every ticket, then resolve", async ({ page }) => {
  const db = service();
  const { data: link } = await db.from("incident_tickets").select("incident_id").eq("ticket_id", created[0]).single();
  const incidentId = link!.incident_id as string;
  const title = `Webhook probe outage ${stamp}`;
  await db.from("incidents").update({ title, draft_update: "We're aware of the problem and are investigating." }).eq("id", incidentId);
  // One ticket in progress, so resolving can resolve it.
  await db.from("tickets").update({ status: "in_progress" }).eq("id", created[0]);

  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.goto("/notes");
  const banner = page.getByRole("region", { name: "Open incidents" });
  await expect(banner).toContainText(title);
  await expect(banner).toContainText("4 tickets, the first");

  // The queue card carries the marker.
  const { data: first } = await db.from("tickets").select("number").eq("id", created[1]).single();
  await page.goto(`/queue?filter=all&q=${encodeURIComponent(`#${first!.number}`)}`);
  await expect(page.getByRole("img", { name: new RegExp(`Part of incident INC-\\d+: ${title}`) })).toBeVisible();

  // The incident page: post the update (two clicks), then resolve.
  // Other incidents may be open too (the banner lists up to two): ours by title.
  await banner.locator("p", { hasText: title }).getByRole("link", { name: /View INC-/ }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await page.getByRole("button", { name: "Post update…" }).click();
  await page.getByRole("button", { name: "Post to 4 tickets" }).click();
  // These act on each ticket in turn: give them longer than the default 5 s.
  await expect(page.getByRole("status")).toHaveText("Posted the update to 4 tickets.", { timeout: 20_000 });
  // Posting again sends nothing twice.
  await page.getByRole("button", { name: "Post update…" }).click();
  await page.getByRole("button", { name: "Post to 4 tickets" }).click();
  await expect(page.getByRole("status")).toHaveText("Every open ticket already has this update.", { timeout: 20_000 });
  const { data: comments } = await db
    .from("ticket_comments")
    .select("ticket_id, is_internal, body")
    .in("ticket_id", created.slice(0, 4));
  expect(comments).toHaveLength(4);
  expect(comments!.every((c) => !c.is_internal && c.body === "We're aware of the problem and are investigating.")).toBe(true);

  await page.getByRole("button", { name: "Resolve…" }).click();
  await page.getByRole("button", { name: "Resolve incident" }).click();
  // The last action's message goes as soon as the next one starts (SUP-45).
  await expect(page.getByText("Every open ticket already has this update.")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Resolved the incident and 1 ticket.", { timeout: 20_000 });
  // Once the refresh lands the actions are gone, and the confirmation stays,
  // with focus (SUP-45: the closed incident used to unmount it).
  await expect(page.getByRole("button", { name: "Resolve…" })).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Resolved the incident and 1 ticket.");
  await expect(page.getByRole("status")).toBeFocused();
  expect((await db.from("tickets").select("status").eq("id", created[0]).single()).data!.status).toBe("resolved");
  expect((await db.from("incidents").select("status").eq("id", incidentId).single()).data!.status).toBe("resolved");
  // Ours leaves the banner. (Others may be open: the suite's own probe
  // tickets are near-identical and filed minutes apart, so they really do
  // form incidents while the suite runs -- the cleanup removes them.)
  await page.goto("/notes");
  await expect(page.getByText(title)).toHaveCount(0);
});

test("a dismissed incident goes quiet and absorbs later look-alikes", async ({ page }) => {
  const base = randomUnit(31);
  // One at a time, as tickets arrive: the third opens the incident.
  let opened = null;
  for (let i = 0; i < 3; i++) opened = await detect((await seed(`Incident probe dismiss ${i}`, similar(base, 40 + i))).id);
  expect(opened?.created).toBe(true);

  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.goto(`/incidents/${opened!.incident_id}`);
  await page.getByRole("button", { name: "Not one problem -- dismiss" }).click();
  await expect(page.getByRole("status")).toHaveText("Dismissed as a false alarm.");
  await expect(page.getByRole("button", { name: "Not one problem -- dismiss" })).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveText("Dismissed as a false alarm.");
  await expect(page.getByRole("status")).toBeFocused();

  // A fourth look-alike joins the dismissed incident instead of opening a new one.
  const late = await seed("Incident probe dismiss late", similar(base, 50));
  expect(await detect(late.id)).toMatchObject({ incident_id: opened!.incident_id, created: false });
  const { data: status } = await service().from("incidents").select("status").eq("id", opened!.incident_id).single();
  expect(status!.status).toBe("dismissed");
});
