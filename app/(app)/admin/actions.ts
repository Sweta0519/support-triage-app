"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/app/lib/auth/session";
import { isAppRole, setUserRole } from "@/app/lib/db/profiles";

// Maps the database's exceptions to the short codes the users page renders.
// The DB is the enforcement; this is just the friendly message.
function errorCode(message: string): string {
  if (message.includes("cannot change your own role")) return "self";
  if (message.includes("cannot demote the last admin")) return "last-admin";
  if (message.includes("no such user")) return "missing";
  return "failed";
}

export async function setRoleAction(formData: FormData) {
  const admin = await requireAdmin();
  const targetUserId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");

  if (!isAppRole(role) || !targetUserId) {
    redirect("/admin/users?error=invalid");
  }
  // Same rule the RPC enforces; checking here too keeps the UI honest even
  // if someone edits the disabled control in devtools.
  if (targetUserId === admin.id) {
    redirect("/admin/users?error=self");
  }

  // redirect() throws, so it must not be called inside the try.
  let failure: string | null = null;
  try {
    await setUserRole(targetUserId, role);
  } catch (err) {
    failure = errorCode(err instanceof Error ? err.message : "");
  }
  if (failure) {
    redirect(`/admin/users?error=${failure}`);
  }

  revalidatePath("/admin/users");
  revalidatePath("/queue");
  redirect("/admin/users?saved=1");
}
