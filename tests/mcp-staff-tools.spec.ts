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
  const [customer, agent] = await Promise.all([throwawayWithToken("mcp-cust"), staff("mcp-agent")]);
  try {
    const related = await triagedTicket(customer, "Earlier double charge");
    const ticket = await triagedTicket(customer, "Charged twice for Pro");
    await service().from("triage_results").update({ related_ticket_ids: [related.id] }).eq("ticket_id", ticket.id);

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
    const asCustomer = await callTool(request, customer.token, "get_ticket", { number: ticket.number });
    expect(JSON.stringify(asCustomer.data)).not.toContain("Checking Stripe.");
    const staffView = await callTool(request, agent.token, "get_ticket", { number: ticket.number });
    expect(staffView.data.conversation).toEqual([
      expect.objectContaining({ from: { you: true }, internal: true, message: { untrusted_text: "Checking Stripe." } }),
    ]);
    expect(staffView.data.assignee).toEqual({ you: true });

    // A correction is recorded as the reviewer's.
    const review = await callTool(request, agent.token, "review_triage", { number: ticket.number, priority: "urgent" });
    expect(review.data).toMatchObject({ outcome: "corrected", priority: "urgent", category: "billing", team: "billing" });
    const { data: state } = await service().from("ticket_triage_state").select("priority, reviewed_by").eq("ticket_id", ticket.id).single();
    expect(state).toEqual({ priority: "urgent", reviewed_by: agent.id });

    // Allowed moves only.
    expect((await callTool(request, agent.token, "set_status", { number: ticket.number, status: "closed" })).error).toContain("can't go from");
    expect((await callTool(request, agent.token, "set_status", { number: ticket.number, status: "in_progress" })).data.status).toBe("in_progress");
    expect((await callTool(request, agent.token, "set_status", { number: ticket.number, status: "resolved" })).data.status).toBe("resolved");
    const { data: row } = await service().from("tickets").select("status, assignee_id").eq("id", ticket.id).single();
    expect(row).toEqual({ status: "resolved", assignee_id: agent.id });
  } finally {
    await cleanup([customer], [agent]);
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
      ["review_triage", {}],
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
