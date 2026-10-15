import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { runWithUserSession } from "@/app/lib/auth/clients";
import { getProfile } from "@/app/lib/auth/session";
import { accessTokenForUser, McpSignInRefused, resolveAccessTokenOwner } from "@/app/lib/db/mcp-auth";
import { checkRateLimit, RateLimitError } from "@/app/lib/db/rate-limit";
import { createMcpServer } from "@/app/lib/mcp/server";

// The MCP connector's endpoint (SUP-54): Streamable HTTP, stateless (one
// request, one fresh server), with JSON responses rather than streams.
//
// Every request must carry "Authorization: Bearer <personal access token>".
// Cookies are never read, so a browser can't be tricked into calling this
// with someone's web session: the CSRF protection Server Actions get doesn't
// apply, and isn't needed (docs/mcp.md). No CORS headers are sent, so a web
// page can't call it with a token either.
//
// The token resolves to its owner, who gets a real Supabase session; the
// request then runs as them (runWithUserSession), so RLS applies exactly as
// in the web app. The role is read from ticketing.profiles on every request,
// after ensure_profile(). The proxy doesn't run for this path (proxy.ts).

const MAX_BODY_BYTES = 256 * 1024;

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}

function unauthorized(message: string) {
  return jsonRpcError(401, -32001, message, { "WWW-Authenticate": 'Bearer realm="support-triage"' });
}

// Our side failed (the database, or Supabase Auth). Logged here, never
// detailed to the caller.
function unavailable(err: unknown) {
  console.error("MCP request failed:", err);
  return jsonRpcError(503, -32603, "Support Triage is unavailable right now. Try again shortly.", { "Retry-After": "30" });
}

export async function POST(request: Request) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return unauthorized("Send a personal access token: Authorization: Bearer <token>.");

  let ownerId: string | null;
  let session: string;
  try {
    ownerId = await resolveAccessTokenOwner(match[1]);
    if (!ownerId) return unauthorized("That access token is invalid, expired or revoked.");
    session = await accessTokenForUser(ownerId);
  } catch (err) {
    if (err instanceof McpSignInRefused) return unauthorized("That access token's account can't sign in.");
    return unavailable(err);
  }

  return runWithUserSession(session, async () => {
    // The budget is counted as soon as there's a session, alongside loading
    // the profile (ensure_profile(), so the role is the current one).
    const [limit, profile] = await Promise.allSettled([checkRateLimit("mcp_request"), getProfile()]);
    if (limit.status === "rejected") {
      if (limit.reason instanceof RateLimitError) {
        return jsonRpcError(429, -32002, "Too many requests. Wait a few minutes and try again.", { "Retry-After": "600" });
      }
      return unavailable(limit.reason);
    }
    if (profile.status === "rejected") return unavailable(profile.reason);
    if (!profile.value || profile.value.id !== ownerId) return unauthorized("That access token's account isn't available.");

    const server = createMcpServer(profile.value);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      maxRequestBodySize: MAX_BODY_BYTES,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  });
}

// Stateless: there's no server-to-client stream to open (GET) or session to
// end (DELETE).
function methodNotAllowed() {
  return jsonRpcError(405, -32000, "Method not allowed. Send MCP requests with POST.", { Allow: "POST" });
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
