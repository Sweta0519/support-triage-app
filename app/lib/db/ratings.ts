import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { MAX_ROWS } from "@/app/lib/db/admin";
import { RateLimitError } from "@/app/lib/db/rate-limit";
export { RATING_COMMENT_MAX_LENGTH } from "@/app/lib/ratings";

// Customer satisfaction (CSAT): one 1-5 rating per resolved ticket, given
// by its customer. Writes go only through ticketing.rate_ticket(); reads
// are RLS-scoped (the customer sees their own, an admin all, an agent the
// ratings credited to them).

export type TicketRating = {
  score: number;
  comment: string | null;
  agent_id: string | null;
  created_at: string;
  updated_at: string;
};

export async function getTicketRating(ticketId: string): Promise<TicketRating | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ticket_ratings")
    .select("score, comment, agent_id, created_at, updated_at")
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export class RatingError extends Error {
  constructor(readonly reason: "not_found" | "not_resolved" | "invalid") {
    super(`rate_ticket refused: ${reason}`);
  }
}

export async function rateTicket(ticketId: string, score: number, comment: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("rate_ticket", {
    p_ticket_id: ticketId,
    p_score: score,
    p_comment: comment,
  });
  if (!error) return;
  if (error.code === "P0002" || error.code === "42501") throw new RatingError("not_found");
  if (error.message === "not_resolved") throw new RatingError("not_resolved");
  if (error.code === "22023") throw new RatingError("invalid");
  if (error.message.includes("rate_limited")) throw new RateLimitError("rate_ticket");
  throw new Error(error.message);
}

export type AnalyticsRating = {
  ticket_id: string;
  score: number;
  comment: string | null;
  agent_id: string | null;
  created_at: string;
  ticket: { number: number; subject: string } | null;
};

// For the admin analytics page (RLS gives an admin every rating). Newest
// first, bounded like the other analytics queries.
export async function listRatingsForAnalytics(): Promise<{ ratings: AnalyticsRating[]; sampled: boolean }> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ticket_ratings")
    .select("ticket_id, score, comment, agent_id, created_at, ticket:tickets(number, subject)")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) {
    throw new Error(error.message);
  }
  const ratings = data as unknown as AnalyticsRating[];
  return { ratings, sampled: ratings.length >= MAX_ROWS };
}
