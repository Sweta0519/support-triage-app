import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { RateLimitError } from "@/app/lib/db/rate-limit";

// Personal access tokens (SUP-53). Every function runs with the caller's own
// session: RLS shows only their own tokens, the token hash is never readable
// by clients (no column grant), the secret is generated and hashed by
// ticketing.create_access_token(), and revoking goes through
// ticketing.revoke_access_token(). Resolving a presented token for the MCP
// endpoint is service-role only (ticketing.resolve_access_token).

export type AccessToken = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

const TOKEN_COLUMNS = "id, name, prefix, created_at, last_used_at, expires_at, revoked_at";

export class TooManyTokensError extends Error {
  constructor() {
    super("You already have the maximum number of active tokens. Revoke one first.");
    this.name = "TooManyTokensError";
  }
}

export async function listMyAccessTokens(): Promise<AccessToken[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("access_tokens").select(TOKEN_COLUMNS).order("created_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Creates a token for the caller and returns its secret, which is shown once
// and never stored: the database generates it and keeps only its hash.
export async function createAccessToken(name: string, expiresInDays: number | null): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_access_token", { p_name: name, p_expires_in_days: expiresInDays });
  if (error) {
    if (error.message.includes("too_many_tokens")) throw new TooManyTokensError();
    if (error.message.includes("rate_limited")) throw new RateLimitError("access_token");
    throw new Error(error.message);
  }
  return data as string;
}

export async function revokeAccessToken(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("revoke_access_token", { p_id: id });
  if (error) {
    throw new Error(error.message);
  }
  return Boolean(data);
}
