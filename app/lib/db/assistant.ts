import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

export const ASSISTANT_MESSAGE_MAX_LENGTH = 8_000;

export type AssistantMessage = {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  model: string | null;
  created_at: string;
};

// One conversation per staff member (a personal scratchpad, not a list of
// threads), enforced by a unique constraint on owner_id -- so this is
// insert-first, fall back to reading the existing row on a conflict,
// rather than select-then-insert. Two concurrent requests from the same
// staff member (a double-click, or two open tabs) would otherwise both see
// no existing row and both insert one, splitting their history in two.
export async function getOrCreateActiveConversation(ownerId: string): Promise<string> {
  const supabase = await createServerSupabaseClient();

  const { data: created, error: insertError } = await supabase
    .from("assistant_conversations")
    .insert({ owner_id: ownerId })
    .select("id")
    .single();

  if (!insertError) {
    return created.id;
  }
  if (insertError.code !== "23505") {
    throw new Error(insertError.message);
  }

  const { data: existing, error: selectError } = await supabase
    .from("assistant_conversations")
    .select("id")
    .eq("owner_id", ownerId)
    .single();

  if (selectError) {
    throw new Error(selectError.message);
  }
  return existing.id;
}

export async function listMessages(conversationId: string): Promise<AssistantMessage[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("assistant_messages")
    .select("id, conversation_id, role, content, model, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Bounded, for building the model's context: the full conversation is kept
// forever for display (listMessages above), but re-fetching all of it on
// every send would make both the DB round-trip and the request payload
// grow without limit as a scratchpad ages. Fetches the last `limit` rows
// directly (order desc + limit, then reversed) instead of pulling
// everything and slicing in JS.
export async function listRecentMessages(
  conversationId: string,
  limit: number
): Promise<AssistantMessage[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("assistant_messages")
    .select("id, conversation_id, role, content, model, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }
  return data.reverse();
}

// Unlike add_comment/create_ticket, this table has no BEFORE INSERT
// rate-limit trigger -- the caller (sendMessageAction) checks the
// assistant_message rate limit explicitly before calling this, the same
// way rerunTriageAction does for rerun_triage.
export async function appendMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  model?: string
): Promise<AssistantMessage> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("assistant_messages")
    .insert({ conversation_id: conversationId, role, content, model: model ?? null })
    .select("id, conversation_id, role, content, model, created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const { error: touchError } = await supabase
    .from("assistant_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
  if (touchError) {
    throw new Error(touchError.message);
  }

  return data;
}
