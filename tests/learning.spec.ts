import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { acceptanceByCategory, acceptanceByWeek, describeCorrection, LEARNING_SIMILARITY, weekStart } from "../app/lib/learning";
import { buildTriageRequests } from "../app/lib/ai/triage-prompts";
import { login, requireEnv } from "./helpers";

// SUP-43: the team's past corrections guide the AI's triage of similar
// tickets. Seeds tickets with controlled embeddings (exact similarity, no
// model call) and runs the same SQL the pipeline uses.

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
function signedIn(email: string, password: string) {
  const c = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return c.auth.signInWithPassword({ email, password }).then(() => c);
}

// mulberry32 unit vectors (see incidents.spec.ts): similar(base) ~0.9, bases ~0.
function randomUnit(seed: number): number[] {
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

// A ticket with an embedding and an AI run; `review` sets the staff values
// (a correction when they differ from the AI's).
async function seed(
  subject: string,
  embedding: number[],
  ai: { priority: string; category: string; team: string },
  review?: { priority: string; category: string; team: string }
) {
  const db = service();
  const { data: customer } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: customer!.id, subject: `${subject} ${stamp}`, body: "Learning probe body" })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  created.push(ticket.id);
  await db.from("ticket_embeddings").insert({ ticket_id: ticket.id, embedding: `[${embedding.join(",")}]`, embedding_model: "test" });
  const { data: run, error: runError } = await db
    .from("triage_results")
    .insert({ ticket_id: ticket.id, model: "test/model", prompt_version: "test", summary: `Summary of ${subject}`, ...ai })
    .select("id")
    .single();
  if (runError) throw new Error(runError.message);
  if (review) {
    const { error: e } = await db
      .from("ticket_triage_state")
      .update({ ...review, triage_status: "completed", reviewed_at: new Date().toISOString(), reviewed_result_id: run.id })
      .eq("ticket_id", ticket.id);
    if (e) throw new Error(e.message);
  }
  return ticket as { id: string; number: number };
}

async function match(embedding: number[], exclude: string, limit = 3) {
  const { data, error } = await service().rpc("match_triage_corrections", {
    p_embedding: `[${embedding.join(",")}]`,
    p_exclude_ticket_id: exclude,
    p_threshold: LEARNING_SIMILARITY,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data as { ticket_id: string }[]).map((r) => r.ticket_id);
}

test.afterAll(async () => {
  if (created.length) await service().from("tickets").delete().in("id", created);
});

test("corrections are described by what changed; acceptance by week and by category", () => {
  expect(
    describeCorrection(
      { priority: "normal", category: "account", team: "support" },
      { priority: "high", category: "account", team: "engineering" }
    )
  ).toBe("priority normal → high, team support → engineering");
  expect(weekStart("2026-10-14T10:00:00Z")).toBe("2026-10-12"); // a Wednesday -> its Monday
  const same = { priority: "high", category: "bug", team: "engineering" };
  const rows = [
    { reviewed_at: "2026-10-13T09:00:00Z", ai: same, corrected: same },
    { reviewed_at: "2026-10-14T09:00:00Z", ai: same, corrected: { ...same, team: "support" } },
    { reviewed_at: "2026-10-06T09:00:00Z", ai: same, corrected: same },
  ];
  expect(acceptanceByWeek(rows, 2, new Date("2026-10-14T12:00:00Z"))).toEqual([
    { week: "2026-10-05", accepted: 1, reviewed: 1 },
    { week: "2026-10-12", accepted: 1, reviewed: 2 },
  ]);
  expect(acceptanceByCategory(rows)).toEqual([{ category: "bug", accepted: 2, reviewed: 3 }]);
});

test("past corrections reach the assessment as summaries only, never the reply call", () => {
  const ticket = { subject: "SSO login loops", body: "Our SAML SSO redirects back to the login page." };
  const correction = {
    ticket_id: "00000000-0000-0000-0000-000000000001",
    summary: "Customer's Okta SSO login fails; contact ops@acme-example.com",
    ai: { priority: "normal", category: "account", team: "support" },
    corrected: { priority: "high", category: "account", team: "engineering" },
  };
  const requests = buildTriageRequests(ticket, [], [correction]);
  expect(requests.assessment.user).toContain("<past_corrections>");
  expect(requests.assessment.user).toContain("Customer's Okta SSO login fails");
  expect(requests.assessment.user).toContain("team corrected to: priority high, category account, team engineering");
  // Scrubbed, and no ids the model could confuse with duplicate candidates.
  expect(requests.assessment.user).not.toContain("ops@acme-example.com");
  expect(requests.assessment.user).not.toContain(correction.ticket_id);
  expect(requests.reply.user).not.toContain("past_corrections");
  expect(requests.reply.user).not.toContain("Okta");
  // With none, the block says so.
  expect(buildTriageRequests(ticket, []).assessment.user).toContain("No past corrections.");
});

test("only similar, corrected, non-excluded tickets are used, at most the limit", async () => {
  const sso = randomUnit(101);
  const ai = { priority: "normal", category: "account", team: "support" };
  const fixed = { priority: "high", category: "account", team: "engineering" };
  const c1 = await seed("Learning SSO 1", similar(sso, 1), ai, fixed);
  const c2 = await seed("Learning SSO 2", similar(sso, 2), ai, fixed);
  const confirmed = await seed("Learning SSO confirmed", similar(sso, 3), ai, ai); // reviewed, unchanged
  await seed("Learning SSO unreviewed", similar(sso, 4), ai); // never reviewed
  const unrelated = await seed("Learning unrelated", randomUnit(202), ai, fixed); // corrected, but different
  const probe = similar(sso, 9);
  const newTicket = await seed("Learning SSO new", probe, ai);

  const used = await match(probe, newTicket.id);
  expect(used.sort()).toEqual([c1.id, c2.id].sort());
  expect(used).not.toContain(confirmed.id);
  expect(used).not.toContain(unrelated.id);
  expect(await match(probe, newTicket.id, 1)).toHaveLength(1);

  // An admin excludes one; an agent can't.
  const agent = await signedIn(requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  expect((await agent.rpc("set_learning_excluded", { p_ticket_id: c1.id, p_excluded: true })).error).not.toBeNull();
  const admin = await signedIn(requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  expect((await admin.rpc("set_learning_excluded", { p_ticket_id: c1.id, p_excluded: true })).error).toBeNull();
  expect(await match(probe, newTicket.id)).toEqual([c2.id]);
  // The exclusion is recorded in the ticket's history...
  const { data: events } = await service().from("ticket_events").select("event_type").eq("ticket_id", c1.id).eq("event_type", "learning_excluded");
  expect(events).toHaveLength(1);
  // ...and belongs to that review: a new review of the ticket clears it.
  await service().from("ticket_triage_state").update({ reviewed_at: new Date().toISOString() }).eq("ticket_id", c1.id);
  expect((await match(probe, newTicket.id)).sort()).toEqual([c1.id, c2.id].sort());
  // Only a reviewed ticket can be excluded.
  const { error: unreviewed } = await admin.rpc("set_learning_excluded", { p_ticket_id: newTicket.id, p_excluded: true });
  expect(unreviewed?.code).toBe("P0002");
  // Analytics' count uses the same rule over every ticket (and needs admin).
  const { data: count } = await admin.rpc("learnable_correction_count");
  expect(count as number).toBeGreaterThanOrEqual(2);
  expect((await agent.rpc("learnable_correction_count")).error).not.toBeNull();

  // Customers can't run the match at all.
  const customer = await signedIn(requireEnv("TEST_USER_EMAIL"), requireEnv("TEST_USER_PASSWORD"));
  const { error } = await customer.rpc("match_triage_corrections", {
    p_embedding: `[${probe.join(",")}]`,
    p_exclude_ticket_id: newTicket.id,
    p_threshold: 0,
    p_limit: 3,
  });
  expect(error).not.toBeNull();
});

test("the triage panel says what the AI learned from; admins can stop it learning from one", async ({ page }) => {
  const db = service();
  const sso = randomUnit(303);
  const ai = { priority: "normal", category: "account", team: "support" };
  const fixed = { priority: "high", category: "account", team: "engineering" };
  const c1 = await seed("Learning panel SSO 1", similar(sso, 11), ai, fixed);
  const c2 = await seed("Learning panel SSO 2", similar(sso, 12), ai, fixed);
  const target = await seed("Learning panel SSO new", similar(sso, 13), fixed);
  await db
    .from("triage_results")
    .update({
      learned_from: [c1.id, c2.id],
      learned_examples: [c1, c2].map((c) => ({ ticket_id: c.id, ai, corrected: fixed })),
    })
    .eq("ticket_id", target.id);
  await db.from("ticket_triage_state").update({ triage_status: "completed" }).eq("ticket_id", target.id);

  await login(page, requireEnv("TEST_ADMIN_EMAIL"), requireEnv("TEST_ADMIN_PASSWORD"));
  await page.goto(`/tickets/${target.id}`);
  const learned = page.getByText("✦ Used 2 past corrections as examples");
  await expect(learned).toBeVisible();
  await learned.click();
  await expect(page.getByRole("link", { name: new RegExp(`#${c1.number} Learning panel SSO 1`) })).toBeVisible();
  await expect(page.getByText("priority normal → high, team support → engineering").first()).toBeVisible();
  await page.getByRole("button", { name: "Don't learn from this" }).first().click();
  await expect(page.getByText("not used any more")).toBeVisible();
  const { data } = await db.from("ticket_triage_state").select("learning_excluded_at").in("ticket_id", [c1.id, c2.id]);
  expect(data!.filter((r) => r.learning_excluded_at !== null)).toHaveLength(1);

  // An agent who can't open one of the examples sees a count, not a link.
  const { data: admin } = await db.from("profiles").select("id").eq("email", requireEnv("TEST_ADMIN_EMAIL")).single();
  await db.from("tickets").update({ assignee_id: admin!.id, status: "assigned" }).eq("id", c2.id);
  const agentPage = await (await page.context().browser()!.newContext()).newPage();
  await login(agentPage, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await agentPage.goto(`/tickets/${target.id}`);
  await agentPage.getByText("✦ Used 2 past corrections as examples").click();
  await expect(agentPage.getByText("and 1 more on a ticket you can't open, or that no longer exist")).toBeVisible();
  await expect(agentPage.getByRole("button", { name: "Don't learn from this" })).toHaveCount(0);
});
