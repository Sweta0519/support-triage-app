import type { NextRequest } from "next/server";

import { updateSession } from "./app/lib/auth/proxy";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Static files skip the proxy: images, and the homepage's demo video and
    // its captions (public/marketing), which signed-out visitors must reach.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4|vtt)$).*)",
  ],
};
