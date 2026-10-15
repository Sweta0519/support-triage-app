import { expect, test } from "@playwright/test";

import { callTool, listTools, service, setRole, throwawayWithToken } from "./mcp-helpers";

// SUP-56: the staff MCP tools. Throwaway agents and customers, so no shared
// test account's role, tickets or limits change; everything they made is
// deleted with them.

type User = Awaited<ReturnType<typeof throwawayWithToken>>;

const STAFF_TOOLS = ["list_queue", "get_ticket", "claim_ticket", "post_reply", "set_status", "review_triage"];

async function staff(tag: string): Promise<User> {
  const user = await throwawayWithToken(tag);
  await setRole(user.id, "agent");
  return user;
}

// A ticket from `customer` with a finished AI triage run on it.
async function triagedTicket(customer: User, subject: string, ai: Record<string, unknown> = {}) {
  const db = service();
  const { data: ticket, error } = await db
    .from("tickets")
    .insert({ customer_id: customer.id, subject, body: `Body of ${subject}` })
    .select("id, number")
    .single();
  expect(error).toBeNull();
  const fields = { priority: "high", category: "billing", team: "billing", ...ai };
  expect(
    (
      await db.from("triage_results").insert({
        ticket_id: ticket!.id,
        model: "test/seeded",
        prompt_version: "test",
        summary: "Customer was charged twice.",
        priority_reason: "Money taken twice.",
        suggested_reply: "Sorry about the double charge: we've refunded it.",
        missing_info: ["The invoice number"],
        is_escalation_risk: true,
        confidence: 0.9,
        ...fields,
      })
    ).error
  ).toBeNull();
  expect(
    (await db.from("ticket_triage_state").update({ ...fields, triage_status: "completed" }).eq("ticket_id", ticket!.id)).error
  ).toBeNull();
  return ticket as { id: string; number: number };
}

async function cleanup(customers: User[], others: User[]) {
  for (const c of customers) {
    expect((await service().from("tickets").delete().eq("customer_id", c.id)).error).toBeNull();
  }
  for (const u of [...customers, ...others]) await u.remove();
}

test("staff get the staff tools and customers don't; a demoted agent loses them on the next call", async ({ request }) => {
  const [customer, agent] = await Promise.all([throwawayWithToken("mcp-cust"), staff("mcp-agent")]);
  try {
    const customerTools = await listTools(request, customer.token);
    for (const name of STAFF_TOOLS.filter((t) => t !== "get_ticket")) expect(customerTools).not.toContain(name);
    expect(customerTools).toContain("list_my_tickets");
    // A customer calling a staff tool by name gets an error, not data.
    const res = await request.post("/api/mcp", {
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${customer.token}` },
      data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_queue", arguments: {} } }),
    });
    const body = await res.json();
    expect(body.error ?? body.result?.isError).toBeTruthy();

    expect(await listTools(request, agent.token)).toEqual(expect.arrayContaining(["whoami", ...STAFF_TOOLS]));
    expect(await listTools(request, agent.token)).not.toContain("create_ticket");
    await setRole(agent.id, "customer");
    expect(await listTools(request, agent.token)).not.toContain("list_queue");
  } finally {
    await cleanup([customer], [agent]);
  }
});

test("an agent works a ticket: queue, triage, claim, internal note, review, status; the draft is never sent", async ({ request }) => {
  test.setTimeout(90_000);
  const [customer, agent, colleague] = await Promise.all([throwawayWithToken("mcp-cust"), staff("mcp-agent"), staff("mcp-agent")]);
  try {
    const related = await triagedTicket(customer, "Earlier double charge");
    // Related too, but a colleague's: this agent can't see it, so it isn't listed.
    const hidden = await triagedTicket(customer, "Colleague's ticket");
    await service().from("tickets").update({ assignee_id: colleague.id, status: "assigned" }).eq("id", hidden.id);
    const ticket = await triagedTicket(customer, "Charged twice for Pro");
    expect((await service().from("triage_results").update({ related_ticket_ids: [related.id, hidden.id] }).eq("ticket_id", ticket.id)).error).toBeNull();
    // The agent's own follow-up flag puts it on their Flagged tab.
    await service().from("ticket_flags").insert({ user_id: agent.id, ticket_id: ticket.id });
    const flaggedTab = await callTool(request, agent.token, "list_queue", { tab: "flagged" });
    expect(flaggedTab.data.tickets.map((t: { number: string }) => t.number)).toEqual([`#${ticket.number}`]);

    // In the queue, unassigned, with the AI's flags and an SLA.
    const queue = await callTool(request, agent.token, "list_queue", { tab: "unassigned", search: `#${ticket.number}` });
    expect(queue.data.tickets).toEqual([
      expect.objectContaining({
        number: `#${ticket.number}`,
        subject: { untrusted_text: "Charged twice for Pro" },
        assignee: null,
        priority: "high",
        sla: expect.objectContaining({ state: expect.any(String) }),
        ai: { summary: { untrusted_text: "Customer was charged twice." }, escalation_risk: true, needs_human_review: false },
      }),
    ]);

    // The staff view: triage with the draft as a suggestion, related tickets as numbers.
    const read = await callTool(request, agent.token, "get_ticket", { number: ticket.number });
    expect(read.data.triage).toMatchObject({
      status: "completed",
      priority: "high",
      reviewed: false,
      priority_reason: { untrusted_text: "Money taken twice." },
      escalation_risk: true,
      related: [`#${related.number}`],
      still_needed: [{ untrusted_text: "The invoice number" }],
      draft_reply: { suggestion_only: true, text: { untrusted_text: "Sorry about the double charge: we've refunded it." } },
    });
    // Reading it sent nothing: triage stays advisory.
    const { count } = await service().from("ticket_comments").select("id", { count: "exact", head: true }).eq("ticket_id", ticket.id);
    expect(count).toBe(0);

    expect((await callTool(request, agent.token, "claim_ticket", { number: ticket.number })).data).toEqual({
      claimed: `#${ticket.number}`,
      status: "assigned",
    });
    expect((await callTool(request, agent.token, "claim_ticket", { number: ticket.number })).data.already_yours).toBe(true);

    // An internal note: staff see it, the customer doesn't.
    const note = await callTool(request, agent.token, "post_reply", { number: ticket.number, message: "Checking Stripe.", internal: true });
    expect(note.data.internal).toBe(true);
    expect((await callTool(request, agent.token, "post_reply", { number: ticket.number, message: "  " })).error).toContain("empty");
    // An internal note isn't a response to the customer: the SLA clock keeps running.
    const { data: before } = await service().from("tickets").select("first_response_at").eq("id", ticket.id).single();
    expect(before!.first_response_at).toBeNull();
    const asCustomer = await callTool(request, customer.token, "get_ticket", { number: ticket.number });
    expect(JSON.stringify(asCustomer.data)).not.toContain("Checking Stripe.");
    const staffView = await callTool(request, agent.token, "get_ticket", { number: ticket.number });
    expect(staffView.data.conversation).toEqual([
      expect.objectContaining({ from: { you: true }, internal: true, message: { untrusted_text: "Checking Stripe." } }),
    ]);
    expect(staffView.data.assignee).toEqual({ you: true });

    // A review needs an explicit choice, and is tied to what get_ticket showed.
    const shown = staffView.data.triage;
    const ids = { number: ticket.number, assessment_id: shown.assessment_id, reviewed_at: shown.reviewed_at };
    expect(shown.assessment_id).toEqual(expect.any(String));
    expect((await callTool(request, agent.token, "review_triage", ids)).error).toContain("confirm: true");
    const review = await callTool(request, agent.token, "review_triage", { ...ids, priority: "urgent" });
    expect(review.data).toMatchObject({ outcome: "corrected", priority: "urgent", category: "billing", team: "billing" });
    const { data: state } = await service().from("ticket_triage_state").select("priority, reviewed_by").eq("ticket_id", ticket.id).single();
    expect(state).toEqual({ priority: "urgent", reviewed_by: agent.id });
    // Reviewing again from that same, now outdated, read is refused...
    expect((await callTool(request, agent.token, "review_triage", { ...ids, confirm: true })).error).toContain("Someone else reviewed");
    // ...and so is a review of an assessment the AI has since replaced.
    const reread = (await callTool(request, agent.token, "get_ticket", { number: ticket.number })).data.triage;
    await service()
      .from("triage_results")
      .insert({ ticket_id: ticket.id, model: "test/seeded", prompt_version: "test", summary: "Newer run.", confidence: 0.9, priority: "low", category: "billing", team: "billing" });
    expect(
      (await callTool(request, agent.token, "review_triage", { number: ticket.number, assessment_id: reread.assessment_id, reviewed_at: reread.reviewed_at, confirm: true })).error
    ).toContain("changed just now");

    // Allowed moves only.
    expect((await callTool(request, agent.token, "set_status", { number: ticket.number, status: "closed" })).error).toContain("can't go from");
    expect((await callTool(request, agent.token, "set_status", { number: ticket.number, status: "in_progress" })).data.status).toBe("in_progress");
    expect((await callTool(request, agent.token, "set_status", { number: ticket.number, status: "resolved" })).data.status).toBe("resolved");
    const { data: row } = await service().from("tickets").select("status, assignee_id").eq("id", ticket.id).single();
    expect(row).toEqual({ status: "resolved", assignee_id: agent.id });

    // Only the one internal note was ever posted: claiming, reviewing and
    // moving sent nothing, and the draft never went out.
    const { data: comments } = await service().from("ticket_comments").select("body, is_internal").eq("ticket_id", ticket.id);
    expect(comments).toEqual([{ body: "Checking Stripe.", is_internal: true }]);

    // A public reply is the customer's first response; a closed ticket takes none.
    const other = await triagedTicket(customer, "Second issue");
    expect((await callTool(request, agent.token, "set_status", { number: other.number, status: "in_progress" })).data.status).toBe("in_progress");
    const { data: claimedByMove } = await service().from("tickets").select("assignee_id").eq("id", other.id).single();
    expect(claimedByMove!.assignee_id).toBe(agent.id);
    await callTool(request, agent.token, "post_reply", { number: other.number, message: "On it." });
    const { data: answered } = await service().from("tickets").select("first_response_at").eq("id", other.id).single();
    expect(answered!.first_response_at).not.toBeNull();
    await callTool(request, agent.token, "set_status", { number: other.number, status: "resolved" });
    await callTool(request, agent.token, "set_status", { number: other.number, status: "closed" });
    expect((await callTool(request, agent.token, "post_reply", { number: other.number, message: "One more" })).error).toContain("closed");
  } finally {
    await cleanup([customer], [agent, colleague]);
  }
});

test("an admin sees every ticket, but still only makes the moves the board allows", async ({ request }) => {
  const [customer, agent, admin] = await Promise.all([throwawayWithToken("mcp-cust"), staff("mcp-agent"), throwawayWithToken("mcp-admin")]);
  try {
    await setRole(admin.id, "admin");
    const ticket = await triagedTicket(customer, "Admin view");
    await service().from("tickets").update({ assignee_id: agent.id, status: "assigned" }).eq("id", ticket.id);
    const read = await callTool(request, admin.token, "get_ticket", { number: ticket.number });
    expect(read.data.assignee).toEqual({ name: null });
    expect((await callTool(request, admin.token, "set_status", { number: ticket.number, status: "closed" })).error).toContain("can't go from");
  } finally {
    await cleanup([customer], [agent, admin]);
  }
});

test("an agent can't see another agent's ticket, and two agents claiming at once: exactly one wins", async ({ request }) => {
  const [customer, first, second] = await Promise.all([throwawayWithToken("mcp-cust"), staff("mcp-agent"), staff("mcp-agent")]);
  try {
    const race = await triagedTicket(customer, "Claim race");
    const results = await Promise.all([
      callTool(request, first.token, "claim_ticket", { number: race.number }),
      callTool(request, second.token, "claim_ticket", { number: race.number }),
    ]);
    const winners = results.filter((r) => r.data?.claimed);
    expect(winners).toHaveLength(1);
    const loser = results.find((r) => !r.data?.claimed)!;
    // The loser either lost the conditional update or no longer sees the ticket.
    expect(loser.error).toMatch(/Someone else claimed|isn't available to you|assigned to someone else/);
    const { data: row } = await service().from("tickets").select("assignee_id").eq("id", race.id).single();
    const [winner, other] = results[0].data?.claimed ? [first, second] : [second, first];
    expect(row!.assignee_id).toBe(winner.id);

    // Now it's the winner's: to the other agent it doesn't exist, for every tool.
    for (const [name, args] of [
      ["get_ticket", {}],
      ["post_reply", { message: "hi" }],
      ["set_status", { status: "in_progress" }],
      ["review_triage", { assessment_id: null, reviewed_at: null, confirm: true }],
    ] as const) {
      const r = await callTool(request, other.token, name, { number: race.number, ...args });
      expect(r.error, name).toContain("isn't available to you");
    }
    const queue = await callTool(request, other.token, "list_queue", { search: `#${race.number}` });
    expect(queue.data.tickets).toEqual([]);
  } finally {
    await cleanup([customer], [first, second]);
  }
});
