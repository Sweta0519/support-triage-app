"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "./clients";
import { AUTH_RATE_LIMITED_MESSAGE, consumeAuthRateLimit, refundAuthAttempt } from "@/app/lib/db/auth-rate-limit";
import { SITE_URL } from "@/app/lib/site-url";
import { afterSignIn } from "./after-sign-in";
import { ACCESS_PURPOSE_MAX, ACCESS_TEAM_MAX, TEAM_SIZES, type AccessRequestAnswers } from "@/app/lib/access-request-options";

export type AuthFormState = { error: string } | undefined;


function parseCredentials(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  return { email, password };
}

// The "Request access" answers (SUP-58), when the form came from it: all
// optional, trimmed and capped. Null for a plain sign-up.
function accessRequest(formData: FormData): AccessRequestAnswers | null {
  if (formData.get("access") !== "1") return null;
  const size = String(formData.get("size") ?? "");
  return {
    team: String(formData.get("team") ?? "").trim().slice(0, ACCESS_TEAM_MAX),
    size: (TEAM_SIZES as readonly string[]).includes(size) ? size : "",
    purpose: String(formData.get("purpose") ?? "").trim().slice(0, ACCESS_PURPOSE_MAX),
  };
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
  // The only metadata ever sent is the access request's answers: text that
  // becomes a ticket, never a role.
  const request = accessRequest(formData);
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${SITE_URL}/auth/confirm`,
      ...(request ? { data: { access_request: request } } : {}),
    },
  });

  if (error) {
    // Refused before any email went out: give the email's quota back.
    await refundAuthAttempt("sign_up_failed", email);
    return { error: error.message };
  }

  redirect("/login?confirmEmail=1");
}

export async function signInAction(
  _prevState: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  const { email, password } = parseCredentials(formData);
  // Counted before the password is checked: per IP, per email and IP, and
  // per email. If the limiter itself is down this throws, so sign-in fails
  // closed rather than going unthrottled.
  if (!(await consumeAuthRateLimit("sign_in", email))) {
    return { error: AUTH_RATE_LIMITED_MESSAGE };
  }
  const supabase = await createServerSupabaseClient();

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  // Only a wrong password stays counted; anything else (success, an
  // unconfirmed email) gives the attempt back.
  if (error?.code !== "invalid_credentials") {
    await refundAuthAttempt("sign_in_succeeded", email);
  }
  if (error) {
    return { error: error.message };
  }

  redirect((await afterSignIn()) ?? "/");
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
