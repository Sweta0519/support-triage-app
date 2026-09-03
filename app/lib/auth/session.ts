import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "./clients";
import { getOrCreateProfile, type AppRole, type Profile } from "@/app/lib/db/profiles";

export const getUser = cache(async () => {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) {
    return null;
  }
  return data.claims;
});

export async function requireUser() {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}

export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) {
    return null;
  }
  return getOrCreateProfile();
});

export async function requireProfile(): Promise<Profile> {
  await requireUser();
  const profile = await getProfile();
  if (!profile) {
    redirect("/403");
  }
  return profile;
}

export async function requireRole(...roles: AppRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) {
    redirect("/403");
  }
  return profile;
}

export async function requireStaff(): Promise<Profile> {
  return requireRole("agent", "admin");
}

export async function requireAdmin(): Promise<Profile> {
  return requireRole("admin");
}
