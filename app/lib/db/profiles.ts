import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { RateLimitError } from "@/app/lib/db/rate-limit";
import type { Theme } from "@/app/lib/preferences";
import type { Presence } from "@/app/lib/presence";
import type { QueueFilterKey } from "@/app/lib/queue-filters";
import type { QueueSort } from "@/app/lib/queue";

export type AppRole = "customer" | "agent" | "admin";

// role and workspace_id come from the caller's ticketing.workspace_members
// row (SUP-81); ensure_profile() merges them into the profile.
export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: AppRole;
  workspace_id: string;
  theme: Theme;
  queue_default_filter: QueueFilterKey;
  queue_default_sort: QueueSort;
  avatar_path: string | null;
  // Staff only in practice (SUP-76); customers keep the default.
  presence: Presence;
  created_at: string;
  updated_at: string;
};

export const APP_ROLES: readonly AppRole[] = ["customer", "agent", "admin"];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

// RLS decides what comes back: admins get every profile in their workspace,
// agents only staff rows, a customer only their own. Only the admin-gated
// /admin/users page calls this.
export type ProfileSummary = Pick<
  Profile,
  "id" | "email" | "full_name" | "avatar_path" | "role" | "created_at" | "updated_at"
> & {
  // Whether they asked for access through "Get in touch" (SUP-68).
  access_request_status: "pending" | "granted" | "declined" | null;
};

// The role is the membership's (SUP-81). !inner keeps only profiles whose
// membership the caller can see, which RLS limits to their own workspace.
const WITH_ROLE = "membership:workspace_members!inner(role)";

type WithMembership<T> = T & { membership: { role: AppRole } };

function flattenRole<T>({ membership, ...rest }: WithMembership<T>): T & { role: AppRole } {
  return { ...(rest as T), role: membership.role };
}

export async function listProfiles(): Promise<ProfileSummary[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(`id, email, full_name, avatar_path, created_at, updated_at, access_request_status, ${WITH_ROLE}`)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }
  return (data as unknown as WithMembership<Omit<ProfileSummary, "role">>[]).map(flattenRole);
}

export type StaffProfile = Pick<Profile, "id" | "email" | "role" | "full_name" | "avatar_path">;

export async function listStaffProfiles(): Promise<StaffProfile[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(`id, email, full_name, avatar_path, ${WITH_ROLE}`)
    .in("membership.role", ["agent", "admin"]);

  if (error) {
    throw new Error(error.message);
  }
  // By the name people see (display name, else email), not by email.
  const shown = (p: { full_name: string | null; email: string }) => (p.full_name ?? p.email).toLowerCase();
  return (data as unknown as WithMembership<Omit<StaffProfile, "role">>[])
    .map(flattenRole)
    .sort((a, b) => shown(a).localeCompare(shown(b)));
}

// A staff member's email, e.g. for "Filed by …" on a ticket. RLS lets
// staff read other staff profiles in their workspace (and admins everyone
// there); for anyone else,
// or a non-staff id, this is null.
export async function getStaffEmail(id: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(`email, ${WITH_ROLE}`)
    .eq("id", id)
    .in("membership.role", ["agent", "admin"])
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

// A signed-in user may not have a ticketing.profiles row yet -- auth.users
// used to be shared with another app (notes-collections, retired in SUP-79),
// whose users never fired the on-signup trigger for this app. Every current
// user has a row, but ensure_profile() still get-or-creates instead of
// assuming it exists.
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
  // Null keeps the stored value (customers' forms have no queue fields).
  queueDefaultFilter: QueueFilterKey | null;
  queueDefaultSort: QueueSort | null;
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
  // 22023 from the function's own checks, 23514 from a column constraint,
  // 42501 / P0002 if the session or profile vanished since the page loaded.
  if (["22023", "23514", "42501", "P0002"].includes(error.code)) throw new ProfileSettingsError();
  throw new Error(error.message);
}

// set_own_presence() refused the caller (42501: not staff, or no session)
// or the value (22023). Nothing was saved.
export class PresenceRefusedError extends Error {}

// The caller's own presence (SUP-76). set_own_presence() always targets
// auth.uid(), refuses customers, and names only the presence column.
export async function setOwnPresence(presence: Presence): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("set_own_presence", { p_presence: presence });
  if (!error) return;
  if (error.message.includes("rate_limited")) throw new RateLimitError("set_presence");
  if (["42501", "22023"].includes(error.code)) throw new PresenceRefusedError(error.message);
  throw new Error(error.message);
}
