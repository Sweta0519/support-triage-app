// When a model call is retried automatically (SUP-32). Pure functions plus
// a small loop over an injected `send`, so the policy is unit-tested
// without a network. No server-only import for that reason; the only
// caller is app/lib/ai/openrouter.ts, which is server-only.
//
// - "none": interactive or manually recoverable calls (Sage, staff
//   "Re-run triage", saving and searching notes). One request; the caller
//   shows its error and a person retries deliberately.
// - "background": triage of a new ticket, which nobody is watching. Only
//   clearly transient failures are retried: 429 with a Retry-After, 502,
//   503, 504 and network errors -- never a timeout (another 45s wait) or a
//   plain 500 (likely the same answer again). At most MAX_RETRIES, with
//   exponential backoff and jitter, and only while still inside
//   RETRY_WINDOW_MS of the first attempt, so a run stays far below the
//   function time limit and the stall threshold (app/lib/triage-status.ts).

export type RetryPolicy = "none" | "background";

export const MAX_RETRIES = 2;
export const BASE_DELAY_MS = 1_000;
export const MAX_DELAY_MS = 8_000;
// No retry is started this long after the first attempt began.
export const RETRY_WINDOW_MS = 20_000;

// What a failed attempt looked like: an HTTP status (with its Retry-After
// header, if any), a network error, or our own request timeout.
export type AttemptFailure =
  | { kind: "http"; status: number; retryAfter: string | null }
  | { kind: "network" }
  | { kind: "timeout" };

// Retry-After as milliseconds: delta-seconds or an HTTP date
// (IMF-fixdate, "Tue, 13 Oct 2026 10:00:05 GMT"). null when absent or
// anything else -- "1.5" must not reach Date.parse, which reads it as a
// date in 2001 and so "retry now".
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000;
  if (!HTTP_DATE.test(trimmed)) return null;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

// The delay before retry number `retry` (0 for the first retry), or null
// when this failure shouldn't be retried at all.
export function retryDelayMs(
  policy: RetryPolicy,
  failure: AttemptFailure,
  retry: number,
  { random = Math.random, now = Date.now() }: { random?: () => number; now?: number } = {}
): number | null {
  if (policy === "none" || retry >= MAX_RETRIES) return null;
  if (failure.kind === "timeout") return null;

  // The provider says when: honour it, unless that's longer than we wait.
  const retryAfter = failure.kind === "http" ? parseRetryAfter(failure.retryAfter, now) : null;
  if (failure.kind === "http") {
    const { status } = failure;
    if (status === 429) {
      // A 429 without Retry-After may be a quota, not a burst: don't guess.
      if (retryAfter === null || retryAfter > MAX_DELAY_MS) return null;
      return retryAfter;
    }
    if (status !== 502 && status !== 503 && status !== 504) return null;
    if (retryAfter !== null) return retryAfter > MAX_DELAY_MS ? null : retryAfter;
  }

  // Exponential with "equal jitter": half fixed, half random, so retries
  // from parallel calls spread out but never collapse to zero.
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** retry);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export type RetryLog = {
  endpoint: string;
  failure: AttemptFailure;
  retry: number;
  delayMs: number;
};

// What `send` throws for a failed attempt: how it failed, and the error
// to surface if it isn't retried.
export class AttemptError extends Error {
  constructor(
    readonly failure: AttemptFailure,
    readonly cause: unknown
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "AttemptError";
  }
}

// Runs `send` until it succeeds or the policy says stop. Anything `send`
// throws that isn't an AttemptError is surfaced at once. Returns how many
// retries it took, so callers can record it.
export async function withRetries<T>(
  endpoint: string,
  policy: RetryPolicy,
  send: () => Promise<T>,
  {
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    log = (entry: RetryLog) =>
      console.warn(
        `[openrouter] retrying ${entry.endpoint} after ${describeFailure(entry.failure)} ` +
          `(retry ${entry.retry + 1}/${MAX_RETRIES}, waiting ${entry.delayMs}ms)`
      ),
    now = () => Date.now(),
    random = Math.random,
  }: {
    sleep?: (ms: number) => Promise<void>;
    log?: (entry: RetryLog) => void;
    now?: () => number;
    random?: () => number;
  } = {}
): Promise<{ value: T; retries: number }> {
  const startedAt = now();
  for (let retry = 0; ; retry++) {
    try {
      return { value: await send(), retries: retry };
    } catch (err) {
      if (!(err instanceof AttemptError)) throw err;
      const delay = retryDelayMs(policy, err.failure, retry, { random, now: now() });
      if (delay === null || now() + delay - startedAt > RETRY_WINDOW_MS) throw err.cause;
      log({ endpoint, failure: err.failure, retry, delayMs: delay });
      await sleep(delay);
    }
  }
}

function describeFailure(failure: AttemptFailure): string {
  return failure.kind === "http" ? `HTTP ${failure.status}` : failure.kind;
}

// Why a triage run failed, for staff (stored on the triage state and in
// the triage_failed event). Coarse on purpose: no provider error text.
// "budget": the workspace's hourly triage budget was spent (SUP-83), so no
// model was called.
export type TriageFailureReason = "rate_limited" | "provider_unavailable" | "timeout" | "invalid_response" | "error" | "budget";

export function failureReason(failure: AttemptFailure | null): TriageFailureReason {
  if (!failure) return "error";
  if (failure.kind === "timeout") return "timeout";
  if (failure.kind === "network") return "provider_unavailable";
  if (failure.status === 429) return "rate_limited";
  if (failure.status >= 500) return "provider_unavailable";
  return "error";
}
