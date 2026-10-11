import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { RateLimitError } from "@/app/lib/db/rate-limit";
import type { Theme } from "@/app/lib/preferences";
import type { QueueFilterKey } from "@/app/lib/queue-filters";
import type { QueueSort } from "@/app/lib/queue";

export type AppRole = "customer" | "agent" | "admin";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  theme: Theme;
  queue_default_filter: QueueFilterKey;
  queue_default_sort: QueueSort;
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
    .select("id, email, full_name, role, theme, queue_default_filter, queue_default_sort, created_at, updated_at")
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

// A staff member's email, e.g. for "Filed by …" on a ticket. RLS lets
// staff read other staff profiles (and admins everyone); for anyone else,
// or a non-staff id, this is null.
export async function getStaffEmail(id: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("email")
    .eq("id", id)
    .in("role", ["agent", "admin"])
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  return data?.email ?? null;
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

export type ProfileSettings = {
  fullName: string;
  theme: Theme;
  queueDefaultFilter: QueueFilterKey;
  queueDefaultSort: QueueSort;
};

export class ProfileSettingsError extends Error {
  constructor() {
    super("update_own_profile refused the input");
  }
}

// The only write path to a profile for its owner. update_own_profile()
// always targets auth.uid() and names only these four columns, so it can't
// touch role or email (authenticated has no UPDATE grant on profiles).
export async function updateOwnProfile(settings: ProfileSettings): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("update_own_profile", {
    p_full_name: settings.fullName,
    p_theme: settings.theme,
    p_queue_default_filter: settings.queueDefaultFilter,
    p_queue_default_sort: settings.queueDefaultSort,
  });
  if (!error) return;
  if (error.message.includes("rate_limited")) throw new RateLimitError("update_profile");
  // 22023 from the function's own checks, 23514 from a column constraint.
  if (error.code === "22023" || error.code === "23514") throw new ProfileSettingsError();
  throw new Error(error.message);
}
