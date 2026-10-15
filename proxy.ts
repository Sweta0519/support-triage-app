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
    "/((?!_next/static|_next/image|favicon.ico|marketing/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
