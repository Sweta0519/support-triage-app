import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { runWithUserSession } from "@/app/lib/auth/clients";
import { accessTokenForUser, resolveAccessTokenOwner } from "@/app/lib/db/mcp-auth";
import { getOrCreateProfile } from "@/app/lib/db/profiles";
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
// after ensure_profile().

const MAX_BODY_BYTES = 256 * 1024;

function jsonRpcError(status: number, code: number, message: string, headers: Record<string, string> = {}) {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status, headers });
}

function unauthorized(message: string) {
  return jsonRpcError(401, -32001, message, { "WWW-Authenticate": 'Bearer realm="support-triage"' });
}

export async function POST(request: Request) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get("authorization") ?? "");
  if (!match) return unauthorized("Send a personal access token: Authorization: Bearer <token>.");

  const ownerId = await resolveAccessTokenOwner(match[1]);
  if (!ownerId) return unauthorized("That access token is invalid, expired or revoked.");

  return runWithUserSession(await accessTokenForUser(ownerId), async () => {
    const profile = await getOrCreateProfile();
    if (!profile || profile.id !== ownerId) return unauthorized("That access token's account isn't available.");

    try {
      await checkRateLimit("mcp_request");
    } catch (err) {
      if (err instanceof RateLimitError) {
        return jsonRpcError(429, -32002, "Too many requests. Wait a few minutes and try again.", { "Retry-After": "600" });
      }
      throw err;
    }

    const server = createMcpServer(profile);
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
