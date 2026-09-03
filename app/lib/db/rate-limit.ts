import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

export class RateLimitError extends Error {
  constructor(action: string) {
    super(`Rate limit exceeded for ${action}`);
    this.name = "RateLimitError";
  }
}

// Fixed-window counter keyed on the caller's uid + action, tracked in
// ticketing.rate_limits via consume_rate_limit(). The uid half of the key
// comes from the JWT inside the RPC, not from here, so nothing a client
// sends can target another user's bucket.
export async function checkRateLimit(
  action: string,
  limit: number,
  windowSeconds: number
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new RateLimitError(action);
  }
}
