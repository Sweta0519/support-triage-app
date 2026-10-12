// A triage run's status as staff should see it (SUP-30). A run that has
// been "pending" or "processing" for longer than this is treated as
// stalled -- the function that ran it died (timeout, crash, a deploy
// mid-run) -- and can be re-run.
//
// It must stay longer than the longest legitimate run: two model calls of
// up to 2 x 45s each (app/lib/ai/openrouter.ts) is about 3-3.5 minutes,
// inside Vercel's default 300s function limit. If either grows (a longer
// maxDuration, more retries), raise this too, or a live run could be
// reset and race its re-run. Shared by the UI and the re-run path in
// app/lib/db/triage.ts, so "stalled" means the same thing everywhere. No
// server-only import: client components use it too.

export const STALE_TRIAGE_MS = 5 * 60_000;

export type EffectiveTriageStatus = "pending" | "processing" | "completed" | "failed" | "stalled";

// The age of a "processing" run comes from claimed_at (when its claim was
// taken; staff reviews don't touch it). A "pending" ticket that nothing
// ever claimed has only updated_at. With AI not configured, pending is
// expected and never stalled: nothing would run a re-run either.
export function effectiveTriageStatus(
  state:
    | { triage_status?: string | null; updated_at?: string | null; claimed_at?: string | null }
    | null
    | undefined,
  { now = Date.now(), aiConfigured = true }: { now?: number; aiConfigured?: boolean } = {}
): EffectiveTriageStatus {
  const status = state?.triage_status;
  const s = status === "processing" || status === "completed" || status === "failed" ? status : "pending";
  if (!aiConfigured) return s;
  const since = s === "processing" ? state?.claimed_at : s === "pending" ? state?.updated_at : null;
  if (since) {
    const at = Date.parse(since);
    if (!Number.isNaN(at) && now - at > STALE_TRIAGE_MS) return "stalled";
  }
  return s;
}

export function canRerunTriage(status: EffectiveTriageStatus): boolean {
  return status === "completed" || status === "failed" || status === "stalled";
}
