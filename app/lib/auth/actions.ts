"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "./clients";
import { AUTH_RATE_LIMITED_MESSAGE, consumeAuthRateLimit, refundAuthAttempt } from "@/app/lib/db/auth-rate-limit";
import { SITE_URL } from "@/app/lib/site-url";
import { afterSignIn } from "./after-sign-in";
import { PresenceRefusedError, resumePresenceAfterSignIn, signOutPresence } from "@/app/lib/db/profiles";
import { parseAccessRequest, type AccessRequestAnswers } from "@/app/lib/access-request-options";
import { findOpenInvite, findWorkspaceByJoinToken } from "@/app/lib/db/workspaces";
import { WORKSPACE_NAME_MAX } from "@/app/lib/workspace-options";

// On an error, the access-request answers come back too, so the form can
// show them again (React resets uncontrolled fields after an action).
export type AuthFormState = { error: string; request?: AccessRequestAnswers; workspaceName?: string } | undefined;

const LINK_INVALID = "This link isn't valid any more. Ask your team for a new one.";

// Which workspace the new account joins (SUP-82), as sign-up metadata for
// ticketing.handle_new_user(), which checks it again and works out the role
// itself. One of: a join link's token (customer), an invite's token (agent,
// for the email it was made for), or a new workspace's name (admin). "Get
// in touch" sends none and joins the default workspace as a customer.
type WorkspaceIntent = { join_token: string } | { invite_token: string } | { workspace_name: string } | null;

async function workspaceIntent(
  formData: FormData,
  email: string,
  requestingAccess: boolean
): Promise<{ intent: WorkspaceIntent } | { error: string }> {
  const joinToken = String(formData.get("join_token") ?? "");
  const inviteToken = String(formData.get("invite_token") ?? "");
  if (joinToken) {
    return (await findWorkspaceByJoinToken(joinToken)) ? { intent: { join_token: joinToken } } : { error: LINK_INVALID };
  }
  if (inviteToken) {
    const invite = await findOpenInvite(inviteToken);
    if (!invite) return { error: LINK_INVALID };
    if (invite.email !== email.toLowerCase()) {
      return { error: "This invite is for a different email address. Sign up with the address it was sent to." };
    }
    return { intent: { invite_token: inviteToken } };
  }
  if (requestingAccess) return { intent: null };
  const name = String(formData.get("workspace_name") ?? "").trim();
  if (!name) return { error: "Name your team's workspace." };
  if (name.length > WORKSPACE_NAME_MAX) return { error: `Keep the workspace name to ${WORKSPACE_NAME_MAX} characters.` };
  return { intent: { workspace_name: name } };
}


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
  const workspaceName = String(formData.get("workspace_name") ?? "").trim() || undefined;
  // Per IP and per email, before the account is made (and, if the project
  // requires confirmation, before Supabase sends the email).
  if (!(await consumeAuthRateLimit("sign_up", email))) {
    return { error: AUTH_RATE_LIMITED_MESSAGE, request, workspaceName };
  }
  let picked: Awaited<ReturnType<typeof workspaceIntent>>;
  try {
    picked = await workspaceIntent(formData, email, Boolean(request));
  } catch (err) {
    // Looking the link up failed: no account was made.
    await refundAuthAttempt("sign_up_failed", email);
    throw err;
  }
  if ("error" in picked) {
    await refundAuthAttempt("sign_up_failed", email);
    return { error: picked.error, request, workspaceName };
  }
  const supabase = await createServerSupabaseClient();

  // No `options.data` role is ever passed here. ticketing.handle_new_user()
  // works the role out from the workspace intent it can check (a token, or
  // a new workspace's name); never add a role field to this call. The
  // access request's answers are text that becomes a ticket, never a role.
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${SITE_URL}/auth/confirm`,
      data: { ...picked.intent, ...(request ? { access_request: request } : {}) },
    },
  });

  if (error) {
    // Refused: no account was made and no email went out, so give the
    // email's quota back.
    await refundAuthAttempt("sign_up_failed", email);
    // ticketing.handle_new_user() refused the sign-up, which Supabase reports
    // as a generic database error: a link that stopped working since the
    // check above (rotated, revoked, expired, or used), or an email already
    // held by another profile.
    const refused = picked.intent && error.message.includes("Database error");
    const message = !refused
      ? error.message
      : "workspace_name" in picked.intent!
        ? "We couldn't set up your workspace. Try again, or sign up with a different email."
        : LINK_INVALID;
    return { error: message, request, workspaceName };
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

  // Signed in again: their working hours set their status again, if they
  // have any (SUP-85). Best effort, like the sign-out side.
  try {
    await resumePresenceAfterSignIn();
  } catch (err) {
    console.error("[sign-in] resuming presence failed:", err instanceof Error ? err.message : err);
  }

  redirect((await afterSignIn(data.user?.user_metadata)) ?? "/");
}

export async function signOutAction() {
  // Staff signing out show as Offline (SUP-76), set while the session still
  // exists, and held until they sign in again (SUP-85). The function refuses customers itself, so there's no role read
  // first. Best effort: a failure here (e.g. the presence rate limit) is
  // logged and never stops the sign-out.
  try {
    await signOutPresence();
  } catch (err) {
    if (!(err instanceof PresenceRefusedError)) console.error("[sign-out] setting presence to offline failed:", err instanceof Error ? err.message : err);
  }
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
  redirect("/login");
}
