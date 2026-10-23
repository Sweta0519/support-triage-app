"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/app/lib/auth/session";
import { isAppRole, setUserRole } from "@/app/lib/db/profiles";
import { AccessDecisionError, countPendingAccessRequests, decideAccessRequest } from "@/app/lib/db/access-requests";
import { isUuid } from "@/app/lib/db/tickets";
import { NotStaffError, setWorkload, WorkloadInputError } from "@/app/lib/db/workload";
import { DAILY_CAP_MAX, isTimezone } from "@/app/lib/workload";

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

// Grant or decline an access request (SUP-68), from the Access requests page
// or the request's ticket. decide_access_request() checks the caller is an
// admin and that the request is still pending.
export async function decideAccessRequestAction(
  userId: string,
  grant: boolean
): Promise<{ ok: true; outcome: "granted" | "declined" } | { ok: false; error: string }> {
  await requireAdmin();
  if (!isUuid(userId) || typeof grant !== "boolean") return { ok: false, error: "That request can't be found." };
  try {
    const outcome = await decideAccessRequest(userId, grant);
    return { ok: true, outcome };
  } catch (err) {
    if (!(err instanceof AccessDecisionError)) throw err;
    return {
      ok: false,
      error:
        err.reason === "not_pending"
          ? "This request has already been decided."
          : err.reason === "own_request"
            ? "You can't decide your own request."
            : err.reason === "rate_limited"
              ? "You've posted a lot of replies just now. Wait a few minutes and try again."
              : "Only admins can decide access requests.",
    };
  }
  // No revalidatePath here: it would re-render the page at once, moving the
  // card out of the Waiting list before its confirmation could be read. The
  // client refreshes the page (count, lists, ticket) a moment later.
}

// The waiting access requests, for the admin sidebar to re-check while a tab
// stays open (SUP-71): the layout's count is only read on page loads.
// Read-only; requireAdmin() and RLS keep it to admins.
export async function pendingAccessRequestCountAction(): Promise<number> {
  await requireAdmin();
  return countPendingAccessRequests();
}

// One row of Admin > Workload (SUP-77): a person's daily cap of new cases
// (blank = no cap) and their workplace timezone. admin_set_workload()
// re-checks the caller, the values and that the person is still staff.
export type WorkloadState = { status: "saved" } | { status: "error"; error: string } | undefined;

export async function setWorkloadAction(_prevState: WorkloadState, formData: FormData): Promise<WorkloadState> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const rawCap = String(formData.get("cap") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "");
  if (!isUuid(userId)) return { status: "error", error: "That person can't be found." };
  const cap = rawCap === "" ? null : Number(rawCap);
  if (cap !== null && (!Number.isInteger(cap) || cap < 0 || cap > DAILY_CAP_MAX)) {
    return { status: "error", error: `Enter a whole number from 0 to ${DAILY_CAP_MAX}, or leave it blank for no cap.` };
  }
  if (!isTimezone(timezone)) return { status: "error", error: "Choose a timezone from the list." };
  try {
    await setWorkload(userId, cap, timezone);
  } catch (err) {
    if (err instanceof WorkloadInputError) {
      return {
        status: "error",
        error:
          err.field === "timezone"
            ? "The database doesn't know that timezone yet. Choose a nearby city in the same timezone."
            : `Enter a whole number from 0 to ${DAILY_CAP_MAX}, or leave it blank for no cap.`,
      };
    }
    if (err instanceof NotStaffError) return { status: "error", error: "They're no longer on the support team." };
    throw err;
  }
  revalidatePath("/admin/workload");
  return { status: "saved" };
}
