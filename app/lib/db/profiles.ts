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

export const APP_ROLES: readonly AppRole[] = ["customer", "agent", "admin"];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

// RLS decides what comes back: admins get every profile, agents only staff
// rows, a customer only their own. Only the admin-gated /admin/users page
// calls this.
export async function listProfiles(): Promise<Profile[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, created_at, updated_at")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export type StaffProfile = Pick<Profile, "id" | "email" | "role">;

export async function listStaffProfiles(): Promise<StaffProfile[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, email, role")
    .in("role", ["agent", "admin"])
    .order("email", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// The only way a role changes. admin_set_role() re-checks is_admin() itself
// and refuses self-changes and demoting the last admin -- so the guarantees
// hold even if this is ever called from somewhere other than the admin UI.
export async function setUserRole(targetUserId: string, role: AppRole): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("admin_set_role", {
    target_user_id: targetUserId,
    new_role: role,
  });

  if (error) {
    throw new Error(error.message);
  }
}

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
