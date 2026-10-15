import type { NextRequest } from "next/server";

import { updateSession } from "./app/lib/auth/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Static files skip the proxy: images anywhere, and everything in
    // public/marketing (the homepage's demo video, captions and screenshots),
    // which signed-out visitors must reach. The folder, not the extensions,
    // so no other .mp4/.vtt path ever skips the session check.
    // The MCP endpoint (exactly /api/mcp) signs in with access tokens, never
    // cookies, and answers 401 itself (SUP-54), so it skips the proxy too.
    "/((?!_next/static|_next/image|favicon.ico|marketing/|api/mcp$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
