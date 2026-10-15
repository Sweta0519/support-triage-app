import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { RateLimitError } from "@/app/lib/db/rate-limit";

// "Request access" (SUP-58). The sign-up form keeps the visitor's answers in
// their account's metadata; the first time they're signed in, this files them
// as one access-request ticket (ticketing.file_access_request() does it once,
// as the customer, under the ticket rate limit). Null when there was nothing
// to file: no request, already filed, or not a customer.


export async function fileAccessRequestIfPending(): Promise<{ id: string; number: number } | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("file_access_request");
  if (error) {
    if (error.message.includes("rate_limited")) throw new RateLimitError("create_ticket");
    throw new Error(error.message);
  }
  const row = (data as { ticket_id: string; ticket_number: number }[] | null)?.[0];
  return row ? { id: row.ticket_id, number: row.ticket_number } : null;
}
