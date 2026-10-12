// A triage run's status as staff should see it (SUP-30). A run that has
// been "pending" or "processing" for longer than this is treated as
// stalled -- the function that ran it died (timeout, crash, a deploy
// mid-run) -- and can be re-run. Shared by the UI and the re-run path in
// app/lib/db/triage.ts, so "stalled" means the same thing everywhere. No
// server-only import: client components use it too.

export const STALE_TRIAGE_MS = 5 * 60_000;

export type EffectiveTriageStatus = "pending" | "processing" | "completed" | "failed" | "stalled";

// updatedAt: ticket_triage_state.updated_at, bumped by every status change
// (including the claim that sets "processing").
export function effectiveTriageStatus(
  status: string | null | undefined,
  updatedAt: string | null | undefined,
  now: number = Date.now()
): EffectiveTriageStatus {
  const s = status === "processing" || status === "completed" || status === "failed" ? status : "pending";
  if ((s === "pending" || s === "processing") && updatedAt) {
    const changed = Date.parse(updatedAt);
    if (!Number.isNaN(changed) && now - changed > STALE_TRIAGE_MS) return "stalled";
  }
  return s;
}

export function canRerunTriage(status: EffectiveTriageStatus): boolean {
  return status === "completed" || status === "failed" || status === "stalled";
}
