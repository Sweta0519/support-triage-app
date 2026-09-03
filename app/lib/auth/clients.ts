import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// This app's tables all live in the `ticketing` schema (shared Supabase
// project with notes-collections, which owns `public`) -- defaulting every
// client to it here means app/lib/db/ never has to call `.schema('ticketing')`
// itself. Auth methods (supabase.auth.*) are unaffected by this option.
const DB_OPTIONS = { db: { schema: "ticketing" } } as const;

export function createBrowserSupabaseClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey, DB_OPTIONS);
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseAnonKey, {
    ...DB_OPTIONS,
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
