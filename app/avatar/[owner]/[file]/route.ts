import { NextResponse } from "next/server";

import { getProfile } from "@/app/lib/auth/session";
import { downloadAvatar } from "@/app/lib/db/avatars";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Serves a profile picture to signed-in users of this app. Read-only (GET),
// so it needs none of the Server Action CSRF protection. The bucket itself
// has no client policies; this route is the only way to read it. Cached
// briefly, not
// "immutable": a removed picture should disappear from other people's
// browsers too, not linger for a year.
export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; file: string }> }) {
  const { owner, file } = await params;
  if (!UUID.test(owner) || !UUID.test(file)) {
    return new NextResponse(null, { status: 404 });
  }
  // Signed in to this app (a ticketing profile), not just to the shared
  // Supabase project.
  if (!(await getProfile())) {
    return new NextResponse(null, { status: 401 });
  }
  const bytes = await downloadAvatar(owner, `${file}.webp`);
  if (!bytes) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=300",
    },
  });
}
