import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

// Personal "follow up" flags (SUP-27). RLS scopes every query to the
// caller's own flags; flagging requires a ticket the caller can see.

export async function listMyFlaggedTicketIds(): Promise<Set<string>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("ticket_flags").select("ticket_id");
  if (error) {
    throw new Error(error.message);
  }
  return new Set(data.map((row) => row.ticket_id));
}

// Returns false when the ticket isn't visible to the caller (the insert
// policy refuses it). Flagging twice or unflagging an unflagged ticket is
// a no-op.
export async function setFlag(userId: string, ticketId: string, flagged: boolean): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  if (flagged) {
    const { error } = await supabase
      .from("ticket_flags")
      .upsert({ user_id: userId, ticket_id: ticketId }, { onConflict: "user_id,ticket_id", ignoreDuplicates: true });
    if (error) {
      if (error.code === "42501") return false;
      throw new Error(error.message);
    }
    return true;
  }
  const { error } = await supabase.from("ticket_flags").delete().eq("user_id", userId).eq("ticket_id", ticketId);
  if (error) {
    throw new Error(error.message);
  }
  return true;
}
