"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "./clients";
import { AUTH_RATE_LIMITED_MESSAGE, consumeAuthRateLimit, refundAuthAttempt } from "@/app/lib/db/auth-rate-limit";
import { SITE_URL } from "@/app/lib/site-url";
import { afterSignIn } from "./after-sign-in";
import { PresenceRefusedError, setOwnPresence } from "@/app/lib/db/profiles";
import { parseAccessRequest, type AccessRequestAnswers } from "@/app/lib/access-request-options";

// On an error, the access-request answers come back too, so the form can
// show them again (React resets uncontrolled fields after an action).
export type AuthFormState = { error: string; request?: AccessRequestAnswers } | undefined;


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
  const request = parseAccessRequest(formData) ?? undefined;
  // Per IP and per email, before the account is made (and, if the project
  // requires confirmation, before Supabase sends the email).
  if (!(await consumeAuthRateLimit("sign_up", email))) {
    return { error: AUTH_RATE_LIMITED_MESSAGE, request };
  }
  const supabase = await createServerSupabaseClient();

  // No `options.data` role is ever passed here -- role is hard-coded to
  // 'customer' server-side by the ticketing.handle_new_user() trigger, which
  // ignores raw_user_meta_data entirely. Never add a role field to this call.
  // The only metadata ever sent is the access request's answers: text that
  // becomes a ticket, never a role.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${SITE_URL}/auth/confirm`,
      ...(request ? { data: { access_request: request } } : {}),
    },
  });

  if (error) {
    // Refused: no account was made and no email went out, so give the
    // email's quota back.
    await refundAuthAttempt("sign_up_failed", email);
    return { error: error.message, request };
  }

  // With email confirmation off (this project), sign-up signs the person in
  // at once: there's no confirmation link to wait for, so file their access
  // request now (SUP-69) and take them into the app. Otherwise they confirm
  // by email first, and the request is filed on that link.
  if (data.session) {
    redirect((await afterSignIn(data.user?.user_metadata)) ?? "/");
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

  const { data, error } = await supabase.auth.signInWithPassword({
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

  redirect((await afterSignIn(data.user?.user_metadata)) ?? "/");
}

export async function signOutAction() {
  // Staff signing out show as Offline (SUP-76), set while the session still
  // exists. The function refuses customers itself, so there's no role read
  // first. Best effort: a failure here (e.g. the presence rate limit) is
  // logged and never stops the sign-out.
  try {
    await setOwnPresence("offline");
  } catch (err) {
    if (!(err instanceof PresenceRefusedError)) console.error("[sign-out] setting presence to offline failed:", err instanceof Error ? err.message : err);
  }
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
