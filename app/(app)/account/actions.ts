"use server";

import { redirect } from "next/navigation";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { requireProfile } from "@/app/lib/auth/session";
import { deleteOwnAccount, LastAdminError } from "@/app/lib/db/account";

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
