import "server-only";

import { headers } from "next/headers";

import { createServiceSupabaseClient } from "@/app/lib/supabase/service";

// Sign-in / sign-up throttling (SUP-13). ticketing.consume_auth_rate_limit()
// is service-role only: it's keyed by the visitor's IP, which only the
// server knows reliably, so a client able to call it could fill someone
// else's bucket.

export type AuthRateLimitAction = "sign_in" | "sign_in_failed" | "sign_up";

export const AUTH_RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";

const LOOPBACK = new Set(["::1", "127.0.0.1", "::ffff:127.0.0.1"]);

// The visitor's IP. On Vercel, x-forwarded-for is set at the edge and
// can't be supplied by the client. Local development has no real visitor
// IP -- Next's dev server fills in the loopback address -- so there it's
// null (no per-IP bucket) and the test suite's many sign-ins from one
// machine aren't throttled. In production a missing header falls into one
// shared, strict "unknown" bucket rather than escaping the limit.
async function visitorIp(): Promise<string | null> {
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  if (process.env.NODE_ENV !== "production" && (!forwarded || LOOPBACK.has(forwarded))) {
    return null;
  }
  return forwarded || "unknown";
}

// true = go ahead. 'sign_in_failed' only records and always returns true.
export async function consumeAuthRateLimit(action: AuthRateLimitAction, email: string): Promise<boolean> {
  const { data, error } = await createServiceSupabaseClient().rpc("consume_auth_rate_limit", {
    p_action: action,
    p_ip: await visitorIp(),
    p_email: email,
  });
  if (error) {
    throw new Error(error.message);
  }
  return data === true;
}
