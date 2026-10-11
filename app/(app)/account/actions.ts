"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { requireProfile } from "@/app/lib/auth/session";
import { deleteOwnAccount, LastAdminError } from "@/app/lib/db/account";
import { ProfileSettingsError, updateOwnProfile } from "@/app/lib/db/profiles";
import { RATE_LIMITED_MESSAGE, RateLimitError } from "@/app/lib/db/rate-limit";
import { fullNameError, isQueueFilter, isQueueSort, isTheme } from "@/app/lib/preferences";

export type SettingsState = { status: "saved" } | { status: "error"; error: string } | undefined;

export async function updateSettingsAction(
  _prevState: SettingsState,
  formData: FormData
): Promise<SettingsState> {
  // Whose profile comes from the verified session; the form never names one.
  const profile = await requireProfile();

  const fullName = String(formData.get("fullName") ?? "").trim();
  const nameError = fullNameError(fullName);
  if (nameError) {
    return { status: "error", error: nameError };
  }
  const theme = formData.get("theme");
  if (!isTheme(theme)) {
    return { status: "error", error: "Choose a theme." };
  }
  // Customers have no queue, so their form has no queue fields: keep
  // whatever is stored.
  const isStaff = profile.role !== "customer";
  const queueDefaultFilter = isStaff ? formData.get("queueDefaultFilter") : profile.queue_default_filter;
  const queueDefaultSort = isStaff ? formData.get("queueDefaultSort") : profile.queue_default_sort;
  if (!isQueueFilter(queueDefaultFilter) || !isQueueSort(queueDefaultSort)) {
    return { status: "error", error: "Choose a default queue tab and sort." };
  }

  try {
    await updateOwnProfile({ fullName, theme, queueDefaultFilter, queueDefaultSort });
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { status: "error", error: RATE_LIMITED_MESSAGE };
    }
    if (err instanceof ProfileSettingsError) {
      return { status: "error", error: "Those settings couldn't be saved. Check them and try again." };
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
