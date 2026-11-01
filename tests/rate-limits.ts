import { createClient } from "@supabase/supabase-js";

import { requireEnv } from "./helpers";

// Clears one test account's rate-limit counters: every action's row, keyed
// `${profile.id}:<action>`, the same rows tests/reset.setup.ts clears at the
// start of a run. For a spec that files tickets late in a full run, after
// earlier projects have used the account's hourly budget. Service role, test
// accounts only; the limiter itself is not changed.
export async function clearTestUserRateLimits(email: string) {
  const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error } = await db.from("profiles").select("id").eq("email", email).single();
  if (error) throw new Error(error.message);
  const { error: deleteError } = await db.from("rate_limits").delete().like("key", `${profile!.id}:%`);
  if (deleteError) throw new Error(deleteError.message);
}
