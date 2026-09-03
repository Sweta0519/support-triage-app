import "server-only";

import { createClient } from "@supabase/supabase-js";

// Service-role client: bypasses RLS entirely. Deliberately in its own file
// (not app/lib/auth/clients.ts, which also exports a browser client and is
// therefore in the client module graph). Only app/lib/ai/ and the service-
// role functions in app/lib/db/triage.ts may import this. Never pass a
// client-supplied ticket id into a service-role read without the caller
// having already proven it may see that ticket.
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
