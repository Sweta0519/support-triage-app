import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

export type Comment = {
  id: string;
  ticket_id: string;
  author_id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
};

// RLS already hides internal notes from non-staff viewers, but the query is
// still scoped explicitly here too -- same defense-in-depth pattern as
// everywhere else in app/lib/db/.
export async function listComments(
  ticketId: string,
  isStaff: boolean
): Promise<Comment[]> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("ticket_comments")
    .select("id, ticket_id, author_id, body, is_internal, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  if (!isStaff) {
    query = query.eq("is_internal", false);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function addComment(
  ticketId: string,
  authorId: string,
  body: string,
  isInternal: boolean
): Promise<Comment> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ticket_comments")
    .insert({ ticket_id: ticketId, author_id: authorId, body, is_internal: isInternal })
    .select("id, ticket_id, author_id, body, is_internal, created_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}
