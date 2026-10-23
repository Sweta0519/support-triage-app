"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { getUser, requireProfile, requireStaff } from "@/app/lib/auth/session";
import { deleteOwnAccount, LastAdminError, verifyOwnPassword } from "@/app/lib/db/account";
import { AUTH_RATE_LIMITED_MESSAGE, consumeAuthRateLimit, refundAuthAttempt } from "@/app/lib/db/auth-rate-limit";
import { ProfileSettingsError, setOwnPresence, updateOwnProfile } from "@/app/lib/db/profiles";
import { checkRateLimit, RATE_LIMITED_MESSAGE, RateLimitError } from "@/app/lib/db/rate-limit";
import { removeOwnAvatar, replaceOwnAvatar } from "@/app/lib/db/avatars";
import { AVATAR_MAX_UPLOAD_BYTES, AvatarImageError, toAvatarWebp } from "@/app/lib/avatar-image";
import { fullNameError, isQueueFilter, isQueueSort, isTheme } from "@/app/lib/preferences";
import { isPresence } from "@/app/lib/presence";
import { createAccessToken, revokeAccessToken, TooManyTokensError } from "@/app/lib/db/access-tokens";
import { isUuid } from "@/app/lib/db/tickets";
import { TOKEN_LIFETIMES, TOKEN_NAME_MAX_LENGTH } from "@/app/lib/access-token-options";

// On an error the submitted values come back: React resets an uncontrolled
// form after its action, so the form re-renders with these as its defaults
// rather than losing what the user typed.
export type SettingsValues = {
  fullName: string;
  theme: string;
  queueDefaultFilter: string | null;
  queueDefaultSort: string | null;
};
export type SettingsState =
  | { status: "saved" }
  // values: what was submitted (absent when the request never reached the server).
  | { status: "error"; error: string; values?: SettingsValues }
  | undefined;

export async function updateSettingsAction(
  _prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  // Whose profile comes from the verified session; the form never names one.
  const profile = await requireProfile();

  const submitted: SettingsValues = {
    fullName: String(formData.get("fullName") ?? ""),
    theme: String(formData.get("theme") ?? ""),
    queueDefaultFilter: formData.has("queueDefaultFilter") ? String(formData.get("queueDefaultFilter")) : null,
    queueDefaultSort: formData.has("queueDefaultSort") ? String(formData.get("queueDefaultSort")) : null,
  };
  const failed = (error: string): SettingsState => ({ status: "error", error, values: submitted });

  const fullName = submitted.fullName.trim();
  const nameError = fullNameError(fullName);
  if (nameError) {
    return failed(nameError);
  }
  const theme = submitted.theme;
  if (!isTheme(theme)) {
    return failed("Choose a theme.");
  }
  // Customers have no queue, so their form has no queue fields; null tells
  // update_own_profile() to keep whatever is stored.
  let queueDefaultFilter = null;
  let queueDefaultSort = null;
  if (profile.role !== "customer") {
    const filter = submitted.queueDefaultFilter;
    const sort = submitted.queueDefaultSort;
    if (!isQueueFilter(filter) || !isQueueSort(sort)) {
      return failed("Choose a default queue tab and sort.");
    }
    queueDefaultFilter = filter;
    queueDefaultSort = sort;
  }

  try {
    await updateOwnProfile({ fullName, theme, queueDefaultFilter, queueDefaultSort });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return failed(RATE_LIMITED_MESSAGE);
    }
    if (err instanceof ProfileSettingsError) {
      return failed("Those settings couldn't be saved. Check them and try again.");
    }
    throw err;
  }

  // The theme applies to every page under the app layout.
  revalidatePath("/", "layout");
  return { status: "saved" };
}

// email: what was typed, so a mistake doesn't wipe it (React resets the
// form after its action); the password field is always cleared.
export type DeleteAccountState = { error: string; email: string } | undefined;

export async function deleteAccountAction(
  _prevState: DeleteAccountState,
  formData: FormData
): Promise<DeleteAccountState> {
  // The id to delete comes from the verified session, never from the form.
  const profile = await requireProfile();

  const typed = String(formData.get("confirm") ?? "");
  const failed = (error: string): DeleteAccountState => ({ error, email: typed });
  if (typed.trim().toLowerCase() !== profile.email.toLowerCase()) {
    return failed("Type your account email exactly to confirm.");
  }

  // Re-authenticate (security scan L-3): a stolen or unattended session
  // knows the email, but not the password. Throttled like sign-in -- the
  // attempt is counted first and given back unless the password was wrong
  // -- so password guessing through this form is rate-limited too. The
  // email checked is the one in the verified session (the sign-in email),
  // not the profile's copy of it.
  const password = String(formData.get("password") ?? "");
  if (!password) {
    return failed("Enter your current password to confirm.");
  }
  const claims = await getUser();
  const authEmail = typeof claims?.email === "string" ? claims.email : profile.email;
  if (!(await consumeAuthRateLimit("sign_in", authEmail))) {
    return failed(AUTH_RATE_LIMITED_MESSAGE);
  }
  const check = await verifyOwnPassword(authEmail, password);
  if (check !== "wrong") {
    await refundAuthAttempt("sign_in_succeeded", authEmail);
  }
  if (check === "wrong") {
    return failed("That password isn't right.");
  }
  if (check === "busy") {
    return failed(AUTH_RATE_LIMITED_MESSAGE);
  }
  if (check === "unavailable") {
    return failed("Couldn't check your password just now. Please try again in a moment.");
  }

  try {
    await deleteOwnAccount(profile.id);
  } catch (err) {
    if (err instanceof LastAdminError) {
      return failed(err.message);
    }
    throw err;
  }

  // The user no longer exists; clear the session cookies so the browser
  // does not keep presenting a token for a deleted account.
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login?deleted=1");
}

export type AvatarState = { status: "saved" } | { status: "error"; error: string } | undefined;

const AVATAR_ERRORS = {
  too_large: "That picture is over 2 MB. Choose a smaller one.",
  unsupported: "Use a JPEG, PNG or WebP picture.",
} as const;

export async function uploadAvatarAction(_prevState: AvatarState, formData: FormData): Promise<AvatarState> {
  const profile = await requireProfile();

  const file = formData.get("avatar");
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", error: "Choose a picture to upload." };
  }
  // Checked before reading the body into memory; toAvatarWebp checks again.
  if (file.size > AVATAR_MAX_UPLOAD_BYTES) {
    return { status: "error", error: AVATAR_ERRORS.too_large };
  }

  try {
    // Charged before the resize, which is the costly part.
    await checkRateLimit("update_avatar");
    const webp = await toAvatarWebp(Buffer.from(await file.arrayBuffer()));
    await replaceOwnAvatar(profile.id, webp);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { status: "error", error: RATE_LIMITED_MESSAGE };
    }
    if (err instanceof AvatarImageError) {
      return { status: "error", error: AVATAR_ERRORS[err.reason] };
    }
    throw err;
  }

  revalidatePath("/", "layout");
  return { status: "saved" };
}

export async function removeAvatarAction(): Promise<AvatarState> {
  await requireProfile();
  try {
    await checkRateLimit("update_avatar");
    await removeOwnAvatar();
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { status: "error", error: RATE_LIMITED_MESSAGE };
    }
    throw err;
  }
  revalidatePath("/", "layout");
  return { status: "saved" };
}

// Personal access tokens for the MCP connector (SUP-53). The owner comes
// from the verified session; the new token's secret is returned once, to be
// shown once, and never stored (only its hash is).
export type CreateTokenState =
  | { status: "created"; token: string; name: string }
  | { status: "error"; error: string; name: string }
  | undefined;

export async function createAccessTokenAction(_prevState: CreateTokenState, formData: FormData): Promise<CreateTokenState> {
  await requireProfile();
  const name = String(formData.get("name") ?? "").trim();
  const lifetime = String(formData.get("lifetime") ?? "");
  if (!name) return { status: "error", error: "Give the token a name, like the assistant you'll use it with.", name };
  if (name.length > TOKEN_NAME_MAX_LENGTH) {
    return { status: "error", error: `Keep the name under ${TOKEN_NAME_MAX_LENGTH} characters.`, name };
  }
  const choice = TOKEN_LIFETIMES.find((l) => String(l.days ?? "never") === lifetime);
  if (!choice) return { status: "error", error: "Choose when the token expires.", name };
  try {
    const token = await createAccessToken(name, choice.days);
    revalidatePath("/account");
    return { status: "created", token, name };
  } catch (err) {
    if (err instanceof TooManyTokensError) return { status: "error", error: err.message, name };
    if (err instanceof RateLimitError) return { status: "error", error: RATE_LIMITED_MESSAGE, name };
    throw err;
  }
}

export async function revokeAccessTokenAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireProfile();
  const tokenId = String(id);
  if (!isUuid(tokenId)) return { ok: false, error: "That token no longer exists." };
  const revoked = await revokeAccessToken(tokenId);
  revalidatePath("/account");
  return revoked ? { ok: true } : { ok: false, error: "That token was already revoked, or isn't yours." };
}

// The sidebar's Online / Away / Offline dropdown (SUP-76). Staff only; the
// row is always the caller's own (set_own_presence() takes no id).
export async function setPresenceAction(presence: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireStaff();
  if (!isPresence(presence)) return { ok: false, error: "Choose Online, Away or Offline." };
  try {
    await setOwnPresence(presence);
  } catch (err) {
    if (err instanceof RateLimitError) return { ok: false, error: RATE_LIMITED_MESSAGE };
    throw err;
  }
  // No revalidation: the dropdown already shows the choice, and re-rendering
  // the layout would re-run every banner query on each click.
  return { ok: true };
}
