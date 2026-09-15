import { getUser } from "@/app/lib/auth/session";
import { exportOwnData } from "@/app/lib/db/account";

// GET-only and read-only, so it sits outside the Server Action CSRF story
// on purpose: a plain link can trigger a file download, and there is no
// state to change. Session is verified here, not just by proxy.ts.
export async function GET() {
  const user = await getUser();
  if (!user) {
    return Response.json({ error: "Sign in to export your data." }, { status: 401 });
  }

  const data = await exportOwnData();
  const date = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="support-triage-export-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
