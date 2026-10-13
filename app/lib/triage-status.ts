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

// Is AI triage working at all (SUP-36)? Staff see a banner when it isn't,
// because without it the product is a plain ticket inbox: nothing gets a
// category, priority, team, duplicate links or a draft reply.
// - "off": no model key configured. Tickets stay pending forever.
// - "failing": the latest FAILING_STREAK finished runs all failed, the
//   newest within FAILING_WINDOW_MS. One failure is noise (and shows on its
//   own ticket); a streak means new tickets aren't being triaged.
export const FAILING_STREAK = 3;
export const FAILING_WINDOW_MS = 24 * 60 * 60_000;

export type FinishedTriageRun = { triage_status: string; claimed_at: string | null; failure_reason: string | null };

export type AiTriageHealth =
  | { kind: "ok" }
  | { kind: "off" }
  | { kind: "failing"; reason: string | null };

// `recent`: the latest finished runs (completed or failed), newest first.
export function aiTriageHealth(
  configured: boolean,
  recent: FinishedTriageRun[],
  now: number = Date.now()
): AiTriageHealth {
  if (!configured) return { kind: "off" };
  const streak = recent.slice(0, FAILING_STREAK);
  if (streak.length < FAILING_STREAK || !streak.every((run) => run.triage_status === "failed")) {
    return { kind: "ok" };
  }
  const newest = Date.parse(streak[0].claimed_at ?? "");
  if (Number.isNaN(newest) || now - newest > FAILING_WINDOW_MS) return { kind: "ok" };
  return { kind: "failing", reason: streak[0].failure_reason };
}

// The banner's words (app/components/AiTriageBanner.tsx), or null when
// there's nothing to say. Only admins are told the fix. An unknown reason
// is dropped rather than shown raw.
export function aiTriageBannerCopy(health: AiTriageHealth, isAdmin: boolean): { title: string; body: string } | null {
  if (health.kind === "ok") return null;
  if (health.kind === "off") {
    return {
      title: "AI triage is off.",
      body:
        "New tickets aren't being categorised, prioritised, routed to a team, checked for duplicates or given a draft reply, so they need triaging by hand." +
        (isAdmin ? " To turn it on, set OPENROUTER_API_KEY on the server." : ""),
    };
  }
  const why =
    health.reason && Object.hasOwn(TRIAGE_FAILURE_COPY, health.reason)
      ? ` ${TRIAGE_FAILURE_COPY[health.reason as TriageFailureReason]}`
      : "";
  return {
    title: "AI triage is failing.",
    body: `The last ${FAILING_STREAK} runs failed.${why} New tickets aren't being categorised, prioritised, routed or given a draft reply until it recovers; triage them by hand or re-run them later.`,
  };
}
