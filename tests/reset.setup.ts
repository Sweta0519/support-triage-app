import { test as setup } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// The app rate-limits ticket creation to 10/hour per user (the limiter itself
// is verified separately against the live database -- see docs/supabase-
// schema.md). A full suite run creates ~5 tickets as customer A, so two runs
// inside an hour would trip the limit and fail unrelated tests. This resets
// only the test accounts' counters. Needs the service-role key because
// rate_limits is deny-all to users; that key lives in .env.local, never in
// the repo or CI config committed here.
setup("reset test users' rate-limit counters", async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn("SUPABASE_SERVICE_ROLE_KEY not set -- skipping rate-limit reset");
    return;
  }

  const emails = [
    process.env.TEST_USER_EMAIL,
    process.env.TEST_USER_B_EMAIL,
    process.env.TEST_AGENT_EMAIL,
    process.env.TEST_ADMIN_EMAIL,
  ].filter((e): e is string => Boolean(e));

  const db = createClient(url, key, {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profiles, error } = await db.from("profiles").select("id").in("email", emails);
  if (error) {
    throw new Error(error.message);
  }

  for (const profile of profiles ?? []) {
    const { error: deleteError } = await db
      .from("rate_limits")
      .delete()
      .like("key", `${profile.id}:%`);
    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }
});
