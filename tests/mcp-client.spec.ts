import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";

import { service, setRole, throwawayWithToken } from "./mcp-helpers";

// SUP-57: the connector end to end, through the official MCP SDK client (the
// same code path Claude Code and other assistants use), against the running
// app. Each role connects with its own token and calls every tool it's
// offered. The finer rules are in mcp.spec.ts, mcp-customer-tools.spec.ts and
// mcp-staff-tools.spec.ts; this proves a real client can drive them all.

async function connect(baseURL: string, token: string): Promise<Client> {
  const client = new Client({ name: "e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("/api/mcp", baseURL), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
  );
  return client;
}

// The tool's JSON result, failing the test on a tool error.
async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  expect(result.isError, `${name}: ${text}`).toBeFalsy();
  return JSON.parse(text);
}

const names = async (client: Client) => (await client.listTools()).tools.map((t) => t.name).sort();

test("a real MCP client connects as each role and uses every tool it's offered", async ({ baseURL }) => {
  test.setTimeout(120_000);
  // allSettled: if one account fails to set up, the others are still removed.
  const made = await Promise.allSettled([
    throwawayWithToken("mcp-e2e-cust"),
    throwawayWithToken("mcp-e2e-agent"),
    throwawayWithToken("mcp-e2e-admin"),
  ]);
  const users = made.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  if (users.length < 3) {
    await Promise.allSettled(users.map((u) => u.remove()));
    throw new Error("Couldn't set up the test accounts");
  }
  const [customer, agent, admin] = users;
  const clients: Client[] = [];
  try {
    await setRole(agent.id, "agent");
    await setRole(admin.id, "admin");

    // The customer: every customer tool.
    const asCustomer = await connect(baseURL!, customer.token);
    clients.push(asCustomer);
    expect(asCustomer.getServerVersion()?.name).toBe("support-triage");
    expect(asCustomer.getInstructions()).toContain("untrusted_text");
    expect(await names(asCustomer)).toEqual(["add_reply", "create_ticket", "get_ticket", "list_my_tickets", "whoami"]);
    expect(await call(asCustomer, "whoami")).toMatchObject({ email: customer.email, role: "customer" });
    const filed = await call(asCustomer, "create_ticket", { subject: "E2E: export button does nothing", description: "Clicking Export shows no file." });
    const number = Number(String(filed.number).slice(1));
    expect((await call(asCustomer, "list_my_tickets")).tickets.map((t: { number: string }) => t.number)).toContain(filed.number);
    expect((await call(asCustomer, "add_reply", { number, message: "It happens in every browser." })).replied_to).toBe(filed.number);
    expect((await call(asCustomer, "get_ticket", { number })).replies).toHaveLength(1);

    // Let the background triage settle first, so it can't land between the
    // agent's read and review (which would rightly be refused as stale).
    // Where the app has no working model it stays pending, and the wait just
    // ends: then there's no run to race.
    const triageStatus = async () =>
      ((await service().from("ticket_triage_state").select("triage_status, tickets!inner(number)").eq("tickets.number", number).maybeSingle()).data
        ?.triage_status as string | undefined) ?? "pending";
    for (let waited = 0; waited < 90_000 && !["completed", "failed"].includes(await triageStatus()); waited += 1_000) {
      await new Promise((r) => setTimeout(r, 1_000));
    }

    // The agent: every staff tool, on that ticket.
    const asAgent = await connect(baseURL!, agent.token);
    clients.push(asAgent);
    expect(await names(asAgent)).toEqual(["claim_ticket", "get_ticket", "list_queue", "post_reply", "review_triage", "set_status", "whoami"]);
    expect((await call(asAgent, "list_queue", { search: filed.number })).tickets.map((t: { number: string }) => t.number)).toEqual([filed.number]);
    expect((await call(asAgent, "claim_ticket", { number })).claimed).toBe(filed.number);
    const read = await call(asAgent, "get_ticket", { number });
    expect(read.conversation).toHaveLength(1);
    // Triage may still be running; review by hand with explicit values either way.
    const review = await call(asAgent, "review_triage", {
      number,
      assessment_id: read.triage.assessment_id,
      reviewed_at: read.triage.reviewed_at,
      priority: "normal",
      category: "bug",
      team: "engineering",
    });
    expect(review).toMatchObject({ priority: "normal", category: "bug", team: "engineering" });
    expect((await call(asAgent, "post_reply", { number, message: "Thanks, we're on it." })).internal).toBe(false);
    expect((await call(asAgent, "set_status", { number, status: "in_progress" })).status).toBe("in_progress");

    // The admin: sees the agent's ticket in the queue and can read it.
    const asAdmin = await connect(baseURL!, admin.token);
    clients.push(asAdmin);
    expect(await names(asAdmin)).toEqual(await names(asAgent));
    expect((await call(asAdmin, "list_queue", { search: filed.number })).tickets).toHaveLength(1);
    expect((await call(asAdmin, "get_ticket", { number })).status).toBe("in_progress");

    // And the customer sees the agent's reply, not the review.
    const seen = await call(asCustomer, "get_ticket", { number });
    expect(seen.replies.map((r: { message: { untrusted_text: string } }) => r.message.untrusted_text)).toEqual([
      "It happens in every browser.",
      "Thanks, we're on it.",
    ]);
  } finally {
    // Every step runs even if an earlier one fails, so no account is left behind.
    await Promise.allSettled(clients.map((c) => c.close()));
    await service().from("tickets").delete().eq("customer_id", customer.id);
    await Promise.allSettled(users.map((u) => u.remove()));
  }
});
