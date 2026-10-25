import { randomUUID } from "node:crypto";

import { expect, test, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";
import { callTool, service, setRole, throwawayWithToken } from "./mcp-helpers";

// SUP-83 (workspaces, part 3): two workspaces, A and B. A's customer, agent
// and admin can't see or change anything of B's: not in the web app, not
// through the Data API, not through MCP, and not through Sage's notes
// search. AI triage never offers a B ticket as a duplicate, related ticket,
// incident member or correction example. Everything here is made on
// throwaway accounts; a workspace is deleted with its last member.

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: "serial" });

type User = Awaited<ReturnType<typeof throwawayWithToken>>;
type Workspace = { id: string; name: string; admin: User; agent: User; customer: User; customer2: User };

const RUN = `${Date.now()}-${randomUUID().slice(0, 6)}`;
// Every seeded embedding is the same unit vector, so any two seeded tickets
// are a perfect match: only the workspace can keep one from the other.
const VECTOR = `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;

async function workspace(tag: string): Promise<Workspace> {
  const name = `Isolation ${tag} ${RUN}`;
  const admin = await throwawayWithToken(`iso-${tag}-admin`, { workspace_name: name });
  const { data: m } = await service().from("workspace_members").select("workspace_id").eq("user_id", admin.id).single();
  const { data: ws } = await service().from("workspaces").select("join_token").eq("id", m!.workspace_id).single();
  const join = { join_token: ws!.join_token as string };
  const [agent, customer, customer2] = await Promise.all([
    throwawayWithToken(`iso-${tag}-agent`, join),
    throwawayWithToken(`iso-${tag}-cust`, join),
    throwawayWithToken(`iso-${tag}-cust2`, join),
  ]);
  await setRole(agent.id, "agent");
  return { id: m!.workspace_id as string, name, admin, agent, customer, customer2 };
}

// A ticket with a finished AI triage run and the shared embedding.
async function seededTicket(customer: User, subject: string) {
  const db = service();
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: customer.id, subject, body: `Body of ${subject}` })
    .select("id, number")
    .single();
  expect(error).toBeNull();
  const fields = { priority: "high", category: "billing", team: "billing" };
  const { data: run, error: runError } = await db
    .from("triage_results")
    .insert({
      ticket_id: ticket!.id,
      model: "test/seeded",
      prompt_version: "test",
      summary: `Summary of ${subject}`,
      priority_reason: "Seeded.",
      suggested_reply: "Seeded reply.",
      missing_info: [],
      is_escalation_risk: false,
      confidence: 0.9,
      ...fields,
    })
    .select("id")
    .single();
  expect(runError).toBeNull();
  expect(
    (await db.from("ticket_triage_state").update({ ...fields, triage_status: "completed" }).eq("ticket_id", ticket!.id)).error
  ).toBeNull();
  expect(
    (await db.from("ticket_embeddings").insert({ ticket_id: ticket!.id, embedding: VECTOR, embedding_model: "test/seeded" })).error
  ).toBeNull();
  return { id: ticket!.id as string, number: ticket!.number as number, subject, resultId: run!.id as string };
}

// Staff corrected the AI's priority: a learning example (SUP-43).
async function correct(ticket: { id: string; resultId: string }, by: User) {
  expect(
    (
      await service()
        .from("ticket_triage_state")
        .update({ priority: "urgent", reviewed_at: new Date().toISOString(), reviewed_result_id: ticket.resultId, reviewed_by: by.id })
        .eq("ticket_id", ticket.id)
    ).error
  ).toBeNull();
}

// A staff note with the shared embedding, as Sage's search_notes reads it.
async function seededNote(owner: User, title: string) {
  const db = service();
  const { data: note, error } = await db.from("notes").insert({ owner_id: owner.id, title, body: title }).select("id").single();
  expect(error).toBeNull();
  const { data: doc, error: docError } = await db
    .from("documents")
    .insert({ note_id: note!.id, user_id: owner.id, chunk_index: 0, content: title, embedding: VECTOR, embedding_model: "test/seeded" })
    .select("id")
    .single();
  expect(docError).toBeNull();
  return doc!.id as string;
}

async function dataApi(user: User) {
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  expect((await db.auth.signInWithPassword({ email: user.email, password: user.password })).error).toBeNull();
  return db;
}

async function signedIn(browser: Browser, user: User) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, user.email, user.password);
  return { context, page };
}

let A: Workspace;
let B: Workspace;
// B's things A must never reach.
let bTicket: Awaited<ReturnType<typeof seededTicket>>;
let bTicket2: Awaited<ReturnType<typeof seededTicket>>;
let bTicket3: Awaited<ReturnType<typeof seededTicket>>;
let bIncident: { id: string; title: string };
let bLabel: { id: string; name: string };
let bDocument: string;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  [A, B] = await Promise.all([workspace("A"), workspace("B")]);
  const db = service();

  bTicket = await seededTicket(B.customer, `B ticket ${RUN}`);
  bTicket2 = await seededTicket(B.customer, `B ticket two ${RUN}`);
  bTicket3 = await seededTicket(B.customer2, `B ticket three ${RUN}`);
  await correct(bTicket, B.agent);
  expect(
    (await db.from("ticket_comments").insert({ ticket_id: bTicket.id, author_id: B.agent.id, body: `B reply ${RUN}` })).error
  ).toBeNull();

  const title = `B incident ${RUN}`;
  const { data: incident, error } = await db
    .from("incidents")
    .insert({ title, first_seen_at: new Date().toISOString(), workspace_id: B.id })
    .select("id")
    .single();
  expect(error).toBeNull();
  expect((await db.from("incident_tickets").insert({ incident_id: incident!.id, ticket_id: bTicket.id })).error).toBeNull();
  bIncident = { id: incident!.id, title };

  const labelName = `B label ${RUN.slice(-6)}`;
  const { data: label, error: labelError } = await db
    .from("labels")
    .insert({ name: labelName, created_by: B.admin.id })
    .select("id")
    .single();
  expect(labelError).toBeNull();
  expect((await db.from("ticket_labels").insert({ ticket_id: bTicket.id, label_id: label!.id })).error).toBeNull();
  bLabel = { id: label!.id, name: labelName };

  bDocument = await seededNote(B.admin, `B note ${RUN}`);
});

// Customers and agents first: a workspace's only admin can't be deleted
// while others are still in it.
test.afterAll(async () => {
  const db = service();
  for (const ws of [A, B].filter(Boolean)) {
    for (const c of [ws.customer, ws.customer2]) {
      await db.from("tickets").delete().eq("customer_id", c.id);
    }
  }
  for (const ws of [A, B].filter(Boolean)) {
    for (const u of [ws.customer, ws.customer2, ws.agent]) await u.remove();
  }
  for (const ws of [A, B].filter(Boolean)) await ws.admin.remove();
});

test("the Data API shows A's customer, agent and admin nothing of B's, and refuses every write to it", async () => {
  test.setTimeout(90_000);
  const bTickets = [bTicket.id, bTicket2.id, bTicket3.id];
  const bPeople = [B.admin.id, B.agent.id, B.customer.id, B.customer2.id];

  for (const user of [A.customer, A.agent, A.admin]) {
    const db = await dataApi(user);
    const reads = {
      tickets: await db.from("tickets").select("id").in("id", bTickets),
      ticket_comments: await db.from("ticket_comments").select("id").eq("ticket_id", bTicket.id),
      triage_results: await db.from("triage_results").select("id").in("ticket_id", bTickets),
      ticket_triage_state: await db.from("ticket_triage_state").select("ticket_id").in("ticket_id", bTickets),
      incidents: await db.from("incidents").select("id").eq("id", bIncident.id),
      incident_tickets: await db.from("incident_tickets").select("ticket_id").eq("incident_id", bIncident.id),
      labels: await db.from("labels").select("id").eq("id", bLabel.id),
      ticket_labels: await db.from("ticket_labels").select("ticket_id").eq("label_id", bLabel.id),
      workspaces: await db.from("workspaces").select("id").eq("id", B.id),
      workspace_members: await db.from("workspace_members").select("user_id").eq("workspace_id", B.id),
      workspace_invites: await db.from("workspace_invites").select("id").eq("workspace_id", B.id),
      profiles: await db.from("profiles").select("id").in("id", bPeople),
      notes: await db.from("notes").select("id").eq("owner_id", B.admin.id),
      documents: await db.from("documents").select("id").eq("id", bDocument),
    };
    for (const [table, { data }] of Object.entries(reads)) {
      expect(data ?? [], `${user.email} reads ${table}`).toEqual([]);
    }

    // Writes find no row, or are refused outright.
    const moved = await db.from("tickets").update({ status: "resolved" }).eq("id", bTicket.id).select("id");
    expect(moved.data ?? []).toEqual([]);
    const claimed = await db.from("tickets").update({ assignee_id: user.id }).eq("id", bTicket.id).is("assignee_id", null).select("id");
    expect(claimed.data ?? []).toEqual([]);
    const renamed = await db.from("labels").update({ name: "hijacked" }).eq("id", bLabel.id).select("id");
    expect(renamed.data ?? []).toEqual([]);
    const closed = await db.from("incidents").update({ status: "resolved" }).eq("id", bIncident.id).select("id");
    expect(closed.data ?? []).toEqual([]);
    expect((await db.from("ticket_comments").insert({ ticket_id: bTicket.id, author_id: user.id, body: "from A" })).error).not.toBeNull();
    expect((await db.from("ticket_labels").insert({ ticket_id: bTicket.id, label_id: bLabel.id })).error).not.toBeNull();
  }

  const { data: after } = await service().from("tickets").select("status, assignee_id").eq("id", bTicket.id).single();
  expect(after).toEqual({ status: "new", assignee_id: null });
  const { data: label } = await service().from("labels").select("name").eq("id", bLabel.id).single();
  expect(label!.name).toBe(bLabel.name);
  const { data: incident } = await service().from("incidents").select("status").eq("id", bIncident.id).single();
  expect(incident!.status).toBe("open");
  const { count } = await service().from("ticket_comments").select("id", { count: "exact", head: true }).eq("ticket_id", bTicket.id);
  expect(count).toBe(1);
});

test("Sage's notes search only ever finds the caller's own notes", async () => {
  // A's admin has a note matching the query exactly as well as B's does.
  const own = await seededNote(A.admin, `A note ${RUN}`);
  const db = await dataApi(A.admin);
  const { data, error } = await db.rpc("match_documents", { query_embedding: VECTOR, match_threshold: 0, match_count: 10 });
  expect(error).toBeNull();
  expect((data as { document_id: string }[]).map((d) => d.document_id)).toEqual([own]);
});

test("MCP tools act only inside the token owner's workspace", async ({ request }) => {
  test.setTimeout(90_000);
  const aTicket = await seededTicket(A.customer, `A ticket ${RUN}`);
  const n = bTicket.number;

  for (const staff of [A.agent, A.admin]) {
    const queue = await callTool(request, staff.token, "list_queue", {});
    const shown = JSON.stringify(queue.data);
    expect(shown).toContain(aTicket.subject);
    expect(shown).not.toContain("B ticket");
    expect((await callTool(request, staff.token, "list_queue", { search: `#${n}` })).data.tickets).toEqual([]);
    expect((await callTool(request, staff.token, "get_ticket", { number: n })).error).toBeTruthy();
    expect((await callTool(request, staff.token, "claim_ticket", { number: n })).error).toBeTruthy();
    expect((await callTool(request, staff.token, "post_reply", { number: n, message: "from A" })).error).toBeTruthy();
    expect((await callTool(request, staff.token, "set_status", { number: n, status: "resolved" })).error).toBeTruthy();
    expect(
      (await callTool(request, staff.token, "review_triage", { number: n, assessment_id: bTicket.resultId, reviewed_at: null, confirm: true }))
        .error
    ).toBeTruthy();
    expect(JSON.stringify((await callTool(request, staff.token, "whoami")).data)).not.toContain(B.name);
  }

  const mine = await callTool(request, A.customer.token, "list_my_tickets", {});
  expect(JSON.stringify(mine.data)).not.toContain("B ticket");
  expect((await callTool(request, A.customer.token, "get_ticket", { number: n })).error).toBeTruthy();
  expect((await callTool(request, A.customer.token, "add_reply", { number: n, message: "from A" })).error).toBeTruthy();

  const { data: after } = await service().from("tickets").select("status, assignee_id").eq("id", bTicket.id).single();
  expect(after).toEqual({ status: "new", assignee_id: null });
  const { count } = await service().from("ticket_comments").select("id", { count: "exact", head: true }).eq("ticket_id", bTicket.id);
  expect(count).toBe(1);
});

test("the web app shows A's people nothing of B's", async ({ browser }) => {
  test.setTimeout(120_000);
  // getByText matches any case, so no A subject may contain "b ticket".
  const aTicket = await seededTicket(A.customer2, `A queue card ${RUN}`);

  const agent = await signedIn(browser, A.agent);
  try {
    const { page } = agent;
    expect((await page.goto(`/tickets/${bTicket.id}`))!.status()).toBe(404);
    expect((await page.goto(`/incidents/${bIncident.id}`))!.status()).toBe(404);
    await page.goto("/queue?tab=all");
    await expect(page.getByText(aTicket.subject, { exact: true })).toBeVisible();
    await expect(page.getByText(bTicket.subject)).toHaveCount(0);
    await page.goto("/incidents");
    await expect(page.getByText(bIncident.title)).toHaveCount(0);
    await page.goto("/labels");
    await expect(page.getByText(bLabel.name)).toHaveCount(0);
  } finally {
    await agent.context.close();
  }

  const admin = await signedIn(browser, A.admin);
  try {
    const { page } = admin;
    await page.goto("/admin/users");
    await expect(page.getByText(A.agent.email).first()).toBeVisible();
    for (const u of [B.admin, B.agent, B.customer]) await expect(page.getByText(u.email)).toHaveCount(0);
    await page.goto("/admin/workspace");
    await expect(page.getByText(B.name)).toHaveCount(0);
  } finally {
    await admin.context.close();
  }

  const customer = await signedIn(browser, A.customer);
  try {
    expect((await customer.page.goto(`/tickets/${bTicket.id}`))!.status()).toBe(404);
  } finally {
    await customer.context.close();
  }
});

test("AI triage's candidates never cross workspaces: duplicates, corrections and incidents", async () => {
  const db = service();
  const a1 = await seededTicket(A.customer, `A probe ${RUN}`);
  const a2 = await seededTicket(A.customer2, `A twin ${RUN}`);
  await correct(a2, A.agent);
  const bIds = [bTicket.id, bTicket2.id, bTicket3.id];

  // Duplicate/related candidates: A's twin, none of B's identical tickets.
  const { data: matches, error } = await db.rpc("match_tickets", { query_embedding: VECTOR, match_count: 20, exclude_ticket_id: a1.id });
  expect(error).toBeNull();
  const matched = (matches as { ticket_id: string }[]).map((m) => m.ticket_id);
  expect(matched).toContain(a2.id);
  for (const id of bIds) expect(matched).not.toContain(id);

  // Correction examples: A's corrected twin, never B's corrected ticket.
  const { data: corrections, error: corrError } = await db.rpc("match_triage_corrections", {
    p_embedding: VECTOR,
    p_exclude_ticket_id: a1.id,
    p_threshold: 0.45,
    p_limit: 5,
  });
  expect(corrError).toBeNull();
  expect((corrections as { ticket_id: string }[]).map((c) => c.ticket_id)).toEqual([a2.id]);

  // Incidents: B has an open incident and two more ungrouped tickets from two
  // customers, all identical to a1. Counted across workspaces, a1 would join
  // B's incident. A has identical tickets of its own from two customers (the
  // earlier tests' too), so a1 may start an incident: A's, with A's tickets.
  const detect = (ticketId: string) =>
    db.rpc("detect_incident", { p_ticket_id: ticketId, p_threshold: 0.5, p_window_minutes: 60, p_min_tickets: 3 });
  const forA = await detect(a1.id);
  expect(forA.error).toBeNull();
  for (const { incident_id } of forA.data as { incident_id: string }[]) {
    expect(incident_id).not.toBe(bIncident.id);
    const { data: incident } = await db.from("incidents").select("workspace_id").eq("id", incident_id).single();
    expect(incident!.workspace_id).toBe(A.id);
    const { data: members } = await db.from("incident_tickets").select("ticket:tickets!inner(workspace_id)").eq("incident_id", incident_id);
    for (const m of members as unknown as { ticket: { workspace_id: string } }[]) expect(m.ticket.workspace_id).toBe(A.id);
  }
  const { data: bMembers } = await db.from("incident_tickets").select("ticket_id").eq("incident_id", bIncident.id);
  expect(bMembers).toEqual([{ ticket_id: bTicket.id }]);
  // The same call on a B ticket does join B's incident.
  const forB = await detect(bTicket2.id);
  expect(forB.error).toBeNull();
  expect(forB.data).toEqual([expect.objectContaining({ incident_id: bIncident.id, created: false })]);
});

// Hits the real OpenRouter API (two triage runs, a few cents).
test("a live triage run never offers the other workspace's identical ticket", async ({ request }) => {
  test.setTimeout(240_000);
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY must be set in .env.local for this test.");
  const db = service();
  const subject = `Invoice PDF download fails ${RUN}`;
  const description =
    "Clicking Download on any invoice in Billing shows a spinner and then 'Something went wrong'. " +
    "It started this morning, on Chrome and Firefox. I need last month's invoice for my accountant today.";

  async function fileAndWait(user: User) {
    const filed = await callTool(request, user.token, "create_ticket", { subject, description });
    expect(filed.error).toBeUndefined();
    const number = Number(String(filed.data.number).replace("#", ""));
    const { data: ticket } = await db.from("tickets").select("id").eq("number", number).single();
    await expect
      .poll(
        async () => (await db.from("ticket_triage_state").select("triage_status").eq("ticket_id", ticket!.id).single()).data?.triage_status,
        { timeout: 100_000, intervals: [2_000, 3_000, 5_000] }
      )
      .toBe("completed");
    return ticket!.id as string;
  }

  const inB = await fileAndWait(B.customer2);
  const inA = await fileAndWait(A.customer2);

  // The two really are near-identical to the embedding model: across one
  // shared pool, B's ticket would have been the top candidate.
  const { data: embeddings } = await db.from("ticket_embeddings").select("ticket_id, embedding").in("ticket_id", [inA, inB]);
  const [x, y] = (embeddings as { embedding: string }[]).map((e) => JSON.parse(e.embedding) as number[]);
  const dot = x.reduce((s, v, i) => s + v * y[i], 0);
  const norm = (v: number[]) => Math.sqrt(v.reduce((s, w) => s + w * w, 0));
  expect(dot / (norm(x) * norm(y))).toBeGreaterThan(0.9);

  const { data: result } = await db
    .from("triage_results")
    .select("duplicate_of, related_ticket_ids")
    .eq("ticket_id", inA)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  const offered = [result!.duplicate_of, ...result!.related_ticket_ids];
  for (const id of [inB, bTicket.id, bTicket2.id, bTicket3.id]) expect(offered).not.toContain(id);
  const { count } = await db.from("incident_tickets").select("ticket_id", { count: "exact", head: true }).eq("ticket_id", inA);
  expect(count).toBe(0);
});

test("AI-spending actions also count against a workspace-wide budget", async ({ request }) => {
  const db = service();
  const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  // The current and next window, in case the hour turns mid-test.
  const windows = [hour, hour + 3_600_000].map((t) => new Date(t).toISOString());
  const wsKey = `ws:${A.id}:create_ticket`;
  const ticket = { subject: `Budget probe ${RUN}`, description: "Checking the workspace budget." };

  // A's whole budget is spent: A's customer is refused, B's isn't.
  for (const window_start of windows) {
    expect((await db.from("rate_limits").upsert({ key: wsKey, window_start, count: 200 })).error).toBeNull();
  }
  expect((await callTool(request, A.customer.token, "create_ticket", ticket)).error).toContain("too often");
  expect((await callTool(request, B.customer.token, "create_ticket", ticket)).error).toBeUndefined();

  // Someone over their own limit doesn't spend the workspace's.
  await db.from("rate_limits").delete().eq("key", wsKey);
  for (const window_start of windows) {
    expect((await db.from("rate_limits").upsert({ key: `${A.customer.id}:create_ticket`, window_start, count: 10 })).error).toBeNull();
  }
  expect((await callTool(request, A.customer.token, "create_ticket", ticket)).error).toContain("too often");
  const { data: spent } = await db.from("rate_limits").select("count").eq("key", wsKey);
  expect(spent).toEqual([]);
});
