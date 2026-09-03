import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

export type RateLimitedAction = "create_ticket" | "add_comment" | "rerun_triage";

export class RateLimitError extends Error {
  constructor(action: RateLimitedAction) {
    super(`Rate limit exceeded for ${action}`);
    this.name = "RateLimitError";
  }
}

// Fixed-window counter keyed on the caller's uid + action. The limit and
// window for each action live inside ticketing.consume_rate_limit() -- the
// caller only names the action, so nothing a client sends can change how
// much it is allowed or target another user's bucket. create_ticket and
// add_comment are enforced by BEFORE INSERT triggers; this is only for
// rerun_triage, which inserts nothing.
export async function checkRateLimit(action: RateLimitedAction): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("consume_rate_limit", { p_action: action });

  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    throw new RateLimitError(action);
  }
}
