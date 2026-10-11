"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { requireProfile } from "@/app/lib/auth/session";
import { deleteOwnAccount, LastAdminError } from "@/app/lib/db/account";
import { ProfileSettingsError, updateOwnProfile } from "@/app/lib/db/profiles";
import { checkRateLimit, RATE_LIMITED_MESSAGE, RateLimitError } from "@/app/lib/db/rate-limit";
import { removeOwnAvatar, replaceOwnAvatar } from "@/app/lib/db/avatars";
import { AVATAR_MAX_UPLOAD_BYTES, AvatarImageError, toAvatarWebp } from "@/app/lib/avatar-image";
import { fullNameError, isQueueFilter, isQueueSort, isTheme } from "@/app/lib/preferences";

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
  | { status: "error"; error: string; values: SettingsValues }
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

export type DeleteAccountState = { error: string } | undefined;

export async function deleteAccountAction(
  _prevState: DeleteAccountState,
  formData: FormData
): Promise<DeleteAccountState> {
  // The id to delete comes from the verified session, never from the form.
  const profile = await requireProfile();

  const confirmation = String(formData.get("confirm") ?? "").trim().toLowerCase();
  if (confirmation !== profile.email.toLowerCase()) {
    return { error: "Type your account email exactly to confirm." };
  }

  try {
    await deleteOwnAccount(profile.id);
  } catch (err) {
    if (err instanceof LastAdminError) {
      return { error: err.message };
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
