"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "./clients";

export type AuthFormState = { error: string } | undefined;

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function parseCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

export async function signUpAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const { email, password } = parseCredentials(formData);
  const supabase = await createServerSupabaseClient();

  // No `options.data` role is ever passed here -- role is hard-coded to
  // 'customer' server-side by the ticketing.handle_new_user() trigger, which
  // ignores raw_user_meta_data entirely. Never add a role field to this call.
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${SITE_URL}/auth/confirm` },
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/login?confirmEmail=1");
}

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const { email, password } = parseCredentials(formData);
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  redirect("/");
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
