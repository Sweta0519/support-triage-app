import { createServerClient } from "@supabase/ssr";
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

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

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
