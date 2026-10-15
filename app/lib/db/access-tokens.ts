import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { generateAccessToken } from "@/app/lib/access-tokens";
import { RateLimitError } from "@/app/lib/db/rate-limit";

// Personal access tokens (SUP-53). Every function runs with the caller's own
// session: RLS shows and creates only their own tokens, the token hash is
// never readable by clients (no column grant), and revoking goes through
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
// and never stored.
export async function createAccessToken(
  ownerId: string,
  name: string,
  expiresInDays: number | null
): Promise<{ token: string; row: AccessToken }> {
  const supabase = await createServerSupabaseClient();
  const { token, prefix, hash } = generateAccessToken();
  const expires_at = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString() : null;
  const { data, error } = await supabase
    .from("access_tokens")
    .insert({ owner_id: ownerId, name, token_hash: hash, prefix, expires_at })
    .select(TOKEN_COLUMNS)
    .single();
  if (error) {
    if (error.message.includes("too_many_tokens")) throw new TooManyTokensError();
    if (error.message.includes("rate_limited")) throw new RateLimitError("access_token");
    throw new Error(error.message);
  }
  return { token, row: data };
}

export async function revokeAccessToken(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("revoke_access_token", { p_id: id });
  if (error) {
    throw new Error(error.message);
  }
  return Boolean(data);
}
