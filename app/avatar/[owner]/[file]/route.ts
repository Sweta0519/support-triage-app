import { NextResponse } from "next/server";

import { getUser } from "@/app/lib/auth/session";
import { downloadAvatar } from "@/app/lib/db/avatars";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Serves a profile picture to signed-in users. Read-only (GET), so it needs
// none of the Server Action CSRF protection; the storage policy decides
// who may read, through the caller's own session. Each upload gets a new
// name, so the response can be cached for good.
export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; file: string }> }) {
  const { owner, file } = await params;
  if (!UUID.test(owner) || !UUID.test(file)) {
    return new NextResponse(null, { status: 404 });
  }
  if (!(await getUser())) {
    return new NextResponse(null, { status: 401 });
  }
  const bytes = await downloadAvatar(owner, `${file}.webp`);
  if (!bytes) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
