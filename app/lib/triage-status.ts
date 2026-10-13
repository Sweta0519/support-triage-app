// A triage run's status as staff should see it (SUP-30). A run that has
// been "pending" or "processing" for longer than this is treated as
// stalled -- the function that ran it died (timeout, crash, a deploy
// mid-run) -- and can be re-run.
//
// It must stay longer than the longest legitimate run: an embedding, then
// two model calls in parallel, each up to 45s, plus background retries that
// never start more than 20s after a call's first attempt
// (app/lib/ai/retry-policy.ts) -- about 2-2.5 minutes, inside Vercel's
// default 300s function limit. If either grows (a longer timeout or retry
// window, more retries), raise this too, or a live run could be
// reset and race its re-run. Shared by the UI and the re-run path in
// app/lib/db/triage.ts, so "stalled" means the same thing everywhere. No
// server-only import: client components use it too.

import type { TriageFailureReason } from "@/app/lib/ai/retry-policy";

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

// Why the latest run failed (ticket_triage_state.failure_reason, SUP-32),
// in words for staff. A manual re-run is never retried automatically, so
// these say what a retry would face.
export const TRIAGE_FAILURE_COPY: Record<TriageFailureReason, string> = {
  rate_limited: "The AI provider was rate-limiting requests.",
  provider_unavailable: "The AI provider was unavailable.",
  timeout: "The AI provider took too long to answer.",
  invalid_response: "The AI's answer couldn't be read.",
  error: "Something went wrong while running it.",
};

export function triageFailedCopy(reason: string | null | undefined): string {
  const why = reason && Object.hasOwn(TRIAGE_FAILURE_COPY, reason) ? TRIAGE_FAILURE_COPY[reason as TriageFailureReason] : undefined;
  return `Triage failed.${why ? ` ${why}` : ""} You can re-run it.`;
}

// "1 automatic retry" / "2 automatic retries": the panel and the log say
// the same thing.
export function retriesLabel(n: number): string {
  return `${n} automatic retr${n === 1 ? "y" : "ies"}`;
}
