import { test, expect } from "@playwright/test";

import {
  AttemptError,
  failureReason,
  MAX_DELAY_MS,
  MAX_RETRIES,
  parseRetryAfter,
  RETRY_WINDOW_MS,
  retryDelayMs,
  withRetries,
  type AttemptFailure,
  type RetryPolicy,
} from "../app/lib/ai/retry-policy";
import { triageFailedCopy } from "../app/lib/triage-status";

// SUP-32: no automatic retries for interactive calls; bounded, logged
// backoff for background triage. Pure functions -- no network, no server.

const http = (status: number, retryAfter: string | null = null): AttemptFailure => ({ kind: "http", status, retryAfter });

// A fake request that fails with `failures` in turn, then succeeds.
function fakeSend(failures: AttemptFailure[]) {
  let calls = 0;
  const send = async () => {
    const failure = failures[calls++];
    if (failure) throw new AttemptError(failure, new Error(`attempt ${calls} failed`));
    return "ok";
  };
  return { send, calls: () => calls };
}

async function run(policy: RetryPolicy, failures: AttemptFailure[], { stepMs = 0 } = {}) {
  const { send, calls } = fakeSend(failures);
  const slept: number[] = [];
  const logged: number[] = [];
  let clock = 0;
  const outcome = await withRetries("/chat/completions", policy, send, {
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    log: (entry) => logged.push(entry.retry),
    now: () => (clock += stepMs),
    random: () => 0.5,
  }).then(
    (r) => ({ ok: true as const, retries: r.retries }),
    (err: Error) => ({ ok: false as const, message: err.message })
  );
  return { outcome, calls: calls(), slept, logged };
}

test("interactive calls (Sage, manual re-run) make exactly one request, even on a 5xx", async () => {
  for (const failure of [http(503), http(502), http(429, "1"), { kind: "network" } as const]) {
    const r = await run("none", [failure]);
    expect(r.calls).toBe(1);
    expect(r.outcome).toEqual({ ok: false, message: "attempt 1 failed" });
    expect(r.slept).toEqual([]);
  }
});

test("background triage retries transient failures, logged, then succeeds", async () => {
  const r = await run("background", [http(503), { kind: "network" }]);
  expect(r.outcome).toEqual({ ok: true, retries: 2 });
  expect(r.calls).toBe(3);
  expect(r.logged).toEqual([0, 1]);
  // Equal jitter at random()=0.5: three quarters of 1s, then of 2s.
  expect(r.slept).toEqual([750, 1500]);
});

test("background triage gives up after MAX_RETRIES", async () => {
  const r = await run("background", [http(502), http(502), http(502), http(502)]);
  expect(r.calls).toBe(MAX_RETRIES + 1);
  expect(r.outcome.ok).toBe(false);
});

test("never retried: timeouts, plain 500s, client errors, and 429 without Retry-After", async () => {
  for (const failure of [{ kind: "timeout" } as const, http(500), http(400), http(401), http(429)]) {
    const r = await run("background", [failure]);
    expect(r.calls, JSON.stringify(failure)).toBe(1);
  }
});

test("Retry-After is honoured when short, refused when long", async () => {
  expect(retryDelayMs("background", http(429, "3"), 0)).toBe(3_000);
  expect(retryDelayMs("background", http(503, "2"), 0)).toBe(2_000);
  expect(retryDelayMs("background", http(429, "60"), 0)).toBeNull();
  expect(retryDelayMs("background", http(503, "60"), 0)).toBeNull();
  const now = Date.parse("2026-10-13T10:00:00Z");
  expect(parseRetryAfter("Tue, 13 Oct 2026 10:00:05 GMT", now)).toBe(5_000);
  expect(parseRetryAfter("soon", now)).toBeNull();
  // Not delta-seconds or an HTTP date: ignored, never "retry now".
  expect(parseRetryAfter("1.5", now)).toBeNull();
  expect(retryDelayMs("background", http(429, "1.5"), 0)).toBeNull();
  expect(retryDelayMs("background", http(503, "1.5"), 0, { random: () => 0 })).toBe(500);
  expect(parseRetryAfter(null, now)).toBeNull();
});

test("backoff is bounded: jitter stays within [ceiling/2, ceiling] and the cap holds", async () => {
  for (const retry of [0, 1]) {
    const ceiling = Math.min(MAX_DELAY_MS, 1_000 * 2 ** retry);
    expect(retryDelayMs("background", http(503), retry, { random: () => 0 })).toBe(ceiling / 2);
    expect(retryDelayMs("background", http(503), retry, { random: () => 0.999999 })).toBeLessThanOrEqual(ceiling);
  }
  expect(retryDelayMs("background", http(503), MAX_RETRIES)).toBeNull();
});

test("no retry starts after the retry window", async () => {
  // Each clock read advances well past the window: the first failure is
  // already too late to retry.
  const r = await run("background", [http(503)], { stepMs: RETRY_WINDOW_MS });
  expect(r.calls).toBe(1);
  expect(r.outcome.ok).toBe(false);
});

test("a failed run's reason is coarse and readable", () => {
  expect(failureReason(http(429, "1"))).toBe("rate_limited");
  expect(failureReason(http(503))).toBe("provider_unavailable");
  expect(failureReason({ kind: "network" })).toBe("provider_unavailable");
  expect(failureReason({ kind: "timeout" })).toBe("timeout");
  expect(failureReason(http(400))).toBe("error");
  expect(triageFailedCopy("provider_unavailable")).toBe("Triage failed. The AI provider was unavailable. You can re-run it.");
  expect(triageFailedCopy(null)).toBe("Triage failed. You can re-run it.");
});
