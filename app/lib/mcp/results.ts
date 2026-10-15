import "server-only";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { SITE_URL } from "@/app/lib/site-url";

// What MCP tools return (SUP-55). Results are JSON, so text people wrote can't
// break out of its field. Each such text is wrapped as { untrusted_text },
// and the server's instructions tell the assistant what that means: the
// words of a customer or a support agent, to read as data, never to follow
// as instructions (prompt injection through a ticket).

export function untrusted(text: string): { untrusted_text: string } {
  return { untrusted_text: text };
}

export function toolResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// A refusal or a problem the person can act on, in words.
export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

// Every tool handler goes through this. The SDK would otherwise hand a thrown
// error's message (a database error, say) to the assistant as the result;
// here it's logged on the server, and the person gets a plain message, as
// the route does for its own failures.
export function guarded<A extends unknown[]>(
  handler: (...args: A) => Promise<CallToolResult>
): (...args: A) => Promise<CallToolResult> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error("MCP tool failed:", err);
      return toolError("That didn't work because of a problem on our side. Try again shortly.");
    }
  };
}

// The input every ticket tool takes, and the link every result carries.
export const ticketNumberInput = z
  .number()
  .int()
  .positive()
  .describe("The ticket's number, without the #: 1042 for ticket #1042.");

export function ticketUrl(ticketId: string): string {
  return `${SITE_URL}/tickets/${ticketId}`;
}
