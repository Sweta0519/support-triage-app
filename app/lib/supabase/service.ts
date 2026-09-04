import "server-only";

import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS entirely. Deliberately in its own file,
// separate from the user-scoped clients in app/lib/auth/clients.ts, so the
// only way to reach the service-role key is to import this module on
// purpose. Only app/lib/ai/, the service-role functions in
// app/lib/db/triage.ts, and the public-token lookup in app/lib/db/shares.ts
// may import it. Never pass a client-supplied ticket id into a service-role
// read without the caller having already proven it may see that ticket --
// the one exception is shares.ts's token-based public read, where an
// unguessable 128-bit token is itself the proof of authorization, the same
// trust model as a password-reset link.
export function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }

  return createClient(url, key, {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
