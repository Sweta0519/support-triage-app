import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// This app's tables all live in the `ticketing` schema (shared Supabase
// project with notes-collections, which owns `public`) -- defaulting every
// client to it here means app/lib/db/ never has to call `.schema('ticketing')`
// itself. Auth methods (supabase.auth.*) are unaffected by this option.
const DB_OPTIONS = { db: { schema: "ticketing" } } as const;

// No code in the browser ever talks to Supabase (every read and write goes
// through Server Components and Server Actions), so the session cookies
// can be httpOnly: a future XSS can't read the JWT and replay it against
// the Data API from elsewhere. There is deliberately no browser client
// export -- adding one would require script-readable cookies again.
export const AUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

// The MCP endpoint (/api/mcp, SUP-54) has no cookies: a request carries a
// personal access token instead, and runs inside runWithUserSession() with a
// real Supabase session for that token's owner. Within it, every
// createServerSupabaseClient() below sends that session's JWT instead of
// reading cookies, so app/lib/db/ functions run as that user under the same
// RLS as the web app, never as the service role.
const userSession = new AsyncLocalStorage<string>();

export function runWithUserSession<T>(accessToken: string, fn: () => Promise<T>): Promise<T> {
  return userSession.run(accessToken, fn);
}

export async function createServerSupabaseClient() {
  const accessToken = userSession.getStore();
  if (accessToken) {
    // Typed as the cookie client: callers use only the shared query and RPC
    // surface. supabase.auth has no session here (getClaims() returns
    // nothing), so session.ts's requireUser()/requireProfile() don't apply
    // inside the MCP endpoint, which loads the profile itself.
    return createClient(supabaseUrl, supabaseAnonKey, {
      ...DB_OPTIONS,
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }) as unknown as ReturnType<typeof createCookieClient>;
  }
  return createCookieClient(await cookies());
}

function createCookieClient(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    ...DB_OPTIONS,
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component; the proxy refreshes the session instead.
        }
      },
    },
  });
}
