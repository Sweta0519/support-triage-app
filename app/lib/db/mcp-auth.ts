import "server-only";

import { createHash } from "node:crypto";

import { createClient, type Session } from "@supabase/supabase-js";

import { createServiceSupabaseClient } from "@/app/lib/supabase/service";

// The MCP endpoint's sign-in (SUP-54). A request presents a personal access
// token (SUP-53); this module finds its owner and gives the endpoint a real
// Supabase session for them, so everything the request then does runs as
// that user under RLS (runWithUserSession in app/lib/auth/clients.ts).
//
// The project signs its JWTs with an asymmetric key Supabase holds, so the
// server can't mint a user JWT itself. Instead the service role generates a
// one-time sign-in link for the owner (nothing is emailed) and the hash in it
// is exchanged for a session, as clicking the link would. Sessions are kept
// per owner in memory and refreshed with their refresh token, so a new one is
// only created when a server instance first sees that owner, or a refresh
// fails.

const TOKEN_FORMAT = /^st_[A-Za-z0-9_-]{43}$/;

// The token's owner, or null when it's malformed, unknown, revoked or expired.
// Only the SHA-256 hash is sent to the database, which also records the use.
export async function resolveAccessTokenOwner(token: string): Promise<string | null> {
  if (!TOKEN_FORMAT.test(token)) return null;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await createServiceSupabaseClient().rpc("resolve_access_token", { p_token_hash: hash });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

type CachedSession = { accessToken: string; refreshToken: string; expiresAt: number };
const sessions = new Map<string, CachedSession>();
// One sign-in at a time per owner, so concurrent requests share it (and
// don't race to use the same refresh token).
const pending = new Map<string, Promise<string>>();

// Seconds of validity a cached access token must still have to be reused.
const MIN_REMAINING_SECONDS = 60;

export async function accessTokenForUser(userId: string): Promise<string> {
  const cached = sessions.get(userId);
  if (cached && cached.expiresAt - MIN_REMAINING_SECONDS > Date.now() / 1000) {
    return cached.accessToken;
  }
  let signIn = pending.get(userId);
  if (!signIn) {
    signIn = newSession(userId, cached).finally(() => pending.delete(userId));
    pending.set(userId, signIn);
  }
  return signIn;
}

async function newSession(userId: string, previous: CachedSession | undefined): Promise<string> {
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).auth;

  let session: Session | null = null;
  if (previous) {
    const { data } = await auth.refreshSession({ refresh_token: previous.refreshToken });
    session = data.session;
  }
  if (!session) {
    const admin = createServiceSupabaseClient().auth.admin;
    const { data: found, error: userError } = await admin.getUserById(userId);
    if (userError || !found.user?.email) throw new Error(`MCP sign-in: no user ${userId}`);
    // Signing in through a link would confirm an unconfirmed address; only
    // people who could sign in to the web app get a session here.
    if (!found.user.email_confirmed_at) throw new Error("MCP sign-in: the owner's email isn't confirmed");
    const { data: link, error: linkError } = await admin.generateLink({ type: "magiclink", email: found.user.email });
    if (linkError) throw new Error(`MCP sign-in: ${linkError.message}`);
    const { data: verified, error: verifyError } = await auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
    if (verifyError) throw new Error(`MCP sign-in: ${verifyError.message}`);
    session = verified.session;
  }
  if (!session || session.user.id !== userId) {
    sessions.delete(userId);
    throw new Error("MCP sign-in: no session for the token's owner");
  }
  sessions.set(userId, {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? Date.now() / 1000 + session.expires_in,
  });
  return session.access_token;
}
