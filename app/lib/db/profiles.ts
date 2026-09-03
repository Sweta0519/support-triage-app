import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

export type AppRole = "customer" | "agent" | "admin";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  created_at: string;
  updated_at: string;
};

// A signed-in user may not have a ticketing.profiles row yet -- this project
// shares its Supabase project (and auth.users) with notes-collections, so a
// user who signed up there has never fired the on-signup trigger for this
// app. ensure_profile() get-or-creates instead of assuming the row exists.
export async function getOrCreateProfile(): Promise<Profile | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("ensure_profile");

  if (error || !data) {
    return null;
  }

  return data as Profile;
}
