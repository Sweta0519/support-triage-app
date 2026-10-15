import "server-only";

import { createHash } from "node:crypto";

import type { Session } from "@supabase/supabase-js";

import { createSessionlessClient } from "@/app/lib/auth/clients";
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
// fails. A cached session is reused for at most SESSION_REUSE_SECONDS, then
// refreshed: a refresh fails once Auth has ended the session (a ban, a
// password change, a sign-out everywhere), so those take effect within that
// time rather than when the JWT expires. Each new sign-in is a new Supabase session for the owner (it shows
// as a sign-in, and bypasses nothing the web sign-in enforces today: there is
// no MFA or sign-in hook).

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

// A sign-in the owner's account can't have (gone, unconfirmed, banned): the
// endpoint answers 401, as for a bad token. Anything else that fails is an
// outage on our side (503).
export class McpSignInRefused extends Error {
  constructor(reason: string) {
    super(`MCP sign-in refused: ${reason}`);
    this.name = "McpSignInRefused";
  }
}

type CachedSession = { accessToken: string; refreshToken: string; expiresAt: number; obtainedAt: number };
const sessions = new Map<string, CachedSession>();
// One sign-in at a time per owner, so concurrent requests share it (and
// don't race to use the same refresh token).
const pending = new Map<string, Promise<string>>();

// Seconds of validity a cached access token must still have to be reused.
const MIN_REMAINING_SECONDS = 60;
// How long a session is used before it's refreshed (see above).
const SESSION_REUSE_SECONDS = 300;
// Owners kept per server instance; the least recently signed-in go first.
const MAX_CACHED_SESSIONS = 500;
// An owner who can't sign in (McpSignInRefused) isn't retried for a minute,
// so a client retrying their token doesn't repeat the Auth admin calls.
const REFUSAL_SECONDS = 60;
const refused = new Map<string, number>();

export async function accessTokenForUser(userId: string): Promise<string> {
  const now = Date.now() / 1000;
  const cached = sessions.get(userId);
  if (cached && cached.expiresAt - MIN_REMAINING_SECONDS > now && now - cached.obtainedAt < SESSION_REUSE_SECONDS) {
    return cached.accessToken;
  }
  if ((refused.get(userId) ?? 0) > now) throw new McpSignInRefused("recently refused");
  let signIn = pending.get(userId);
  if (!signIn) {
    signIn = newSession(userId, cached)
      .catch((err) => {
        if (err instanceof McpSignInRefused) {
          sessions.delete(userId);
          refused.delete(userId);
          if (refused.size >= MAX_CACHED_SESSIONS) refused.delete(refused.keys().next().value!);
          refused.set(userId, now + REFUSAL_SECONDS);
        }
        throw err;
      })
      .finally(() => pending.delete(userId));
    pending.set(userId, signIn);
  }
  return signIn;
}

async function newSession(userId: string, previous: CachedSession | undefined): Promise<string> {
  const auth = createSessionlessClient().auth;

  let session: Session | null = null;
  if (previous) {
    const { data, error } = await auth.refreshSession({ refresh_token: previous.refreshToken });
    if (error) console.warn(`MCP sign-in: refresh failed for ${userId}, signing in again: ${error.message}`);
    session = data.session;
  }
  if (!session) {
    const admin = createServiceSupabaseClient().auth.admin;
    const { data: found, error: userError } = await admin.getUserById(userId);
    if (userError || !found.user?.email) throw new McpSignInRefused("no such user");
    // Signing in through a link would confirm an unconfirmed address; only
    // people who could sign in to the web app get a session here.
    if (!found.user.email_confirmed_at) throw new McpSignInRefused("email not confirmed");
    if (found.user.banned_until && new Date(found.user.banned_until) > new Date()) throw new McpSignInRefused("banned");
    // Another server instance signing the same owner in at the same moment
    // replaces the link's token, so one retry with a fresh link.
    for (let attempt = 1; !session; attempt++) {
      const { data: link, error: linkError } = await admin.generateLink({ type: "magiclink", email: found.user.email });
      if (linkError) throw new Error(`MCP sign-in: ${linkError.message}`);
      const { data: verified, error: verifyError } = await auth.verifyOtp({ type: "email", token_hash: link.properties.hashed_token });
      if (!verified.session && attempt >= 2) throw new Error(`MCP sign-in: ${verifyError?.message ?? "no session"}`);
      session = verified.session;
    }
  }
  if (session.user.id !== userId) {
    sessions.delete(userId);
    throw new Error("MCP sign-in: the session isn't the token owner's");
  }
  sessions.delete(userId);
  if (sessions.size >= MAX_CACHED_SESSIONS) sessions.delete(sessions.keys().next().value!);
  sessions.set(userId, {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? Date.now() / 1000 + session.expires_in,
    obtainedAt: Date.now() / 1000,
  });
  return session.access_token;
}
