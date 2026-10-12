"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "./clients";
import { AUTH_RATE_LIMITED_MESSAGE, consumeAuthRateLimit } from "@/app/lib/db/auth-rate-limit";

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
  // Per IP and per email, before Supabase sends a confirmation email.
  if (!(await consumeAuthRateLimit("sign_up", email))) {
    return { error: AUTH_RATE_LIMITED_MESSAGE };
  }
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
  // Per IP for every attempt; refused outright once this email has had too
  // many failed attempts recently.
  if (!(await consumeAuthRateLimit("sign_in", email))) {
    return { error: AUTH_RATE_LIMITED_MESSAGE };
  }
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Only a wrong password counts against the email, so nobody can lock
    // an account by trying it a couple of times.
    if (error.code === "invalid_credentials") {
      await consumeAuthRateLimit("sign_in_failed", email);
    }
    return { error: error.message };
  }

  redirect("/");
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
