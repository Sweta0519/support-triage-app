import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import type { AppRole } from "@/app/lib/db/profiles";
import type { Presence } from "@/app/lib/presence";

// Admin > Workload (SUP-77). Both calls are admin-only in the database:
// admin_workload() and admin_set_workload() check is_admin() themselves.

export type WorkloadRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_path: string | null;
  role: AppRole;
  presence: Presence;
  daily_case_cap: number | null;
  timezone: string;
  // Distinct tickets given to them since local midnight in their timezone.
  assigned_today: number;
};

export async function listWorkload(): Promise<WorkloadRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("admin_workload");
  if (error) throw new Error(error.message);
  // By the name people see (display name, else email), as elsewhere.
  const shown = (p: WorkloadRow) => (p.full_name ?? p.email).toLowerCase();
  return (data as WorkloadRow[]).sort((a, b) => shown(a).localeCompare(shown(b)));
}

// Which value admin_set_workload() refused. A timezone the page offered can
// still be refused: the list is Node's, and the database may know an older
// set of zones.
export class WorkloadInputError extends Error {
  constructor(readonly field: "cap" | "timezone") {
    super(`admin_set_workload refused the ${field}`);
  }
}

export class NotStaffError extends Error {
  constructor() {
    super("that person isn't on the support team");
  }
}

export async function setWorkload(targetId: string, cap: number | null, timezone: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("admin_set_workload", {
    p_target: targetId,
    p_cap: cap,
    p_timezone: timezone,
  });
  if (!error) return;
  if (error.code === "22023") throw new WorkloadInputError(error.message.includes("invalid_timezone") ? "timezone" : "cap");
  if (error.code === "P0002") throw new NotStaffError();
  throw new Error(error.message);
}
