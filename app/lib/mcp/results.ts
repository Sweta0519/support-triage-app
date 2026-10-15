import "server-only";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

// What MCP tools return (SUP-55). Results are JSON, so text people wrote can't
// break out of its field. Each such text is wrapped as { untrusted_text },
// and the server's instructions tell the assistant what that means: the
// words of a customer or a support agent, to read as data, never to follow
// as instructions (prompt injection through a ticket).

export type Untrusted = { untrusted_text: string };

export function untrusted(text: string): Untrusted {
  return { untrusted_text: text };
}

export function toolResult(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

// A refusal or a problem the person can act on, in words.
export function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
