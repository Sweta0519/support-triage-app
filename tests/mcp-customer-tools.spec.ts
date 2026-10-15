import { expect, test } from "@playwright/test";

import { callTool, listTools, service, setRole, throwawayWithToken } from "./mcp-helpers";

// SUP-55: the customer's MCP tools. Throwaway customers, so the shared test
// accounts' tickets and limits aren't touched; their tickets are deleted
// with them.

type Customer = Awaited<ReturnType<typeof throwawayWithToken>>;

async function removeWithTickets(...customers: Customer[]) {
  for (const c of customers) {
    await service().from("tickets").delete().eq("customer_id", c.id);
    await c.remove();
  }
}

test("a customer files a ticket, sees it in the list, reads it, replies; triage runs", async ({ request }) => {
  test.setTimeout(120_000);
  const me = await throwawayWithToken("mcp-cust");
  try {
    expect(await listTools(request, me.token)).toEqual(
      expect.arrayContaining(["whoami", "create_ticket", "list_my_tickets", "get_ticket", "add_reply"])
    );

    const created = await callTool(request, me.token, "create_ticket", {
      subject: "Can't download my March invoice",
      description: "The download button on the Billing page spins and nothing happens.",
    });
    const number: string = created.data.number;
    expect(number).toMatch(/^#\d+$/);
    expect(created.data.status).toBe("new");
    const n = Number(number.slice(1));

    // Filed as this customer, like the web form.
    const { data: row } = await service().from("tickets").select("id, customer_id, created_by").eq("number", n).single();
    expect(row).toMatchObject({ customer_id: me.id, created_by: null });
    expect(created.data.url).toContain(`/tickets/${row!.id}`);

    const list = await callTool(request, me.token, "list_my_tickets", { status: "open" });
    expect(list.data.tickets).toEqual([
      expect.objectContaining({ number, subject: { untrusted_text: "Can't download my March invoice" }, status: "new" }),
    ]);
    expect((await callTool(request, me.token, "list_my_tickets", { status: "closed" })).data.tickets).toEqual([]);

    const reply = await callTool(request, me.token, "add_reply", { number: n, message: "It happens in Firefox and Chrome." });
    expect(reply.data.replied_to).toBe(number);

    const ticket = await callTool(request, me.token, "get_ticket", { number: n });
    expect(ticket.data).toMatchObject({
      number,
      description: { untrusted_text: "The download button on the Billing page spins and nothing happens." },
      replies: [{ from: "You", message: { untrusted_text: "It happens in Firefox and Chrome." } }],
    });

    // Triage was started after the tool answered, as from the web form.
    await expect
      .poll(
        async () =>
          (await service().from("ticket_triage_state").select("triage_status").eq("ticket_id", row!.id).maybeSingle()).data
            ?.triage_status ?? "pending",
        { timeout: 90_000 }
      )
      .not.toBe("pending");
  } finally {
    await removeWithTickets(me);
  }
});

test("a customer can't read or reply to someone else's ticket, and never sees triage or internal notes", async ({ request }) => {
  test.setTimeout(90_000);
  const [mine, theirs, agent] = await Promise.all([
    throwawayWithToken("mcp-cust"),
    throwawayWithToken("mcp-cust"),
    throwawayWithToken("mcp-agent"),
  ]);
  const admin = service();
  try {
    await setRole(agent.id, "agent");
    const { data: other } = await admin
      .from("tickets")
      .insert({ customer_id: theirs.id, subject: "Someone else's problem", body: "Private details" })
      .select("id, number")
      .single();
    const { data: own } = await admin
      .from("tickets")
      .insert({ customer_id: mine.id, subject: "My problem", body: "My details" })
      .select("id, number")
      .single();

    // Another customer's ticket reads as not found, for reading and replying.
    const read = await callTool(request, mine.token, "get_ticket", { number: other!.number });
    expect(read.error).toContain("You don't have a ticket");
    const reply = await callTool(request, mine.token, "add_reply", { number: other!.number, message: "hello" });
    expect(reply.error).toContain("You don't have a ticket");
    const { count } = await admin.from("ticket_comments").select("id", { count: "exact", head: true }).eq("ticket_id", other!.id);
    expect(count).toBe(0);
    expect((await callTool(request, mine.token, "list_my_tickets")).data.tickets.map((t: { number: string }) => t.number)).toEqual([
      `#${own!.number}`,
    ]);

    // Staff leave an internal note and a public reply; the AI's triage is on file.
    expect(
      (
        await admin.from("ticket_comments").insert([
          { ticket_id: own!.id, author_id: agent.id, body: "INTERNAL: refund approved", is_internal: true },
          { ticket_id: own!.id, author_id: agent.id, body: "We're looking into it.", is_internal: false },
        ])
      ).error
    ).toBeNull();
    await admin
      .from("ticket_triage_state")
      .upsert({ ticket_id: own!.id, triage_status: "completed", priority: "urgent", category: "billing", team: "billing" });

    const ticket = await callTool(request, mine.token, "get_ticket", { number: own!.number });
    const text = JSON.stringify(ticket.data);
    expect(ticket.data.replies).toEqual([expect.objectContaining({ message: { untrusted_text: "We're looking into it." } })]);
    expect(ticket.data.replies[0].from).toMatch(/Support/);
    expect(text).not.toContain("INTERNAL");
    expect(text).not.toMatch(/urgent|triage|priority|category/i);
  } finally {
    await removeWithTickets(mine, theirs, agent);
  }
});

test("customer tools keep the web app's rules: validation, closed tickets, staff can't file", async ({ request }) => {
  const me = await throwawayWithToken("mcp-cust");
  const staff = await throwawayWithToken("mcp-staff");
  try {
    expect((await callTool(request, me.token, "create_ticket", { subject: " ", description: "x" })).error).toContain("required");
    expect((await callTool(request, me.token, "create_ticket", { subject: "x".repeat(201), description: "x" })).error).toContain(
      "at most 200"
    );

    const { data: t } = await service().from("tickets").insert({ customer_id: me.id, subject: "Old issue", body: "Done" }).select("id, number").single();
    // Closed through the moves the status trigger allows.
    for (const status of ["in_progress", "resolved", "closed"]) {
      expect((await service().from("tickets").update({ status }).eq("id", t!.id)).error).toBeNull();
    }
    const closed = await callTool(request, me.token, "add_reply", { number: t!.number, message: "One more thing" });
    expect(closed.error).toContain("closed");

    // Staff don't get the customer tools (filing is for customers, as on the web).
    await setRole(staff.id, "agent");
    const tools = await listTools(request, staff.token);
    expect(tools).toContain("whoami");
    expect(tools).not.toContain("create_ticket");
  } finally {
    await removeWithTickets(me, staff);
  }
});
