import "server-only";

import { createServiceSupabaseClient } from "@/app/lib/supabase/service";

// The email webhook's one write (SUP-88): record a verified delivery. Runs
// with the service role, because the webhook has no signed-in user; the
// workspace is resolved inside record_inbound_email_event() from the
// recipients' addresses, never passed in.

export type InboundEventOutcome = "duplicate" | "received" | "held" | "ignored";

export async function recordInboundEmailEvent(svixId: string, emailId: string, localParts: string[]): Promise<InboundEventOutcome> {
  const { data, error } = await createServiceSupabaseClient().rpc("record_inbound_email_event", {
    p_svix_id: svixId,
    p_email_id: emailId,
    p_local_parts: localParts,
  });
  if (error) throw new Error(error.message);
  return data as InboundEventOutcome;
}
