import "server-only";

import { createHmac } from "node:crypto";

import { visitorIp } from "@/app/lib/request-ip";
import { createServiceSupabaseClient } from "@/app/lib/supabase/service";

// Sign-in / sign-up throttling (SUP-13). ticketing.consume_auth_rate_limit()
// is service-role only: it's keyed by the visitor's IP, which only the
// server knows reliably, so a client able to call it could fill someone
// else's bucket. Limits and their reasons are in the migrations
// (20261012100000_auth_rate_limits_review.sql).

export type AuthRateLimitAction = "sign_in" | "sign_in_succeeded" | "sign_up" | "sign_up_failed";

export const AUTH_RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a few minutes and try again.";

// The email as the limiter sees it: an HMAC with a server-only secret, so
// the rate_limits table holds no address and no plain hash that could be
// reversed by hashing likely addresses. The service-role key is that
// secret (server-only, already required); rotating it just resets counts.
function emailKey(email: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest("hex");
}

// true = go ahead. 'sign_in' counts the attempt before the password is
// checked (so parallel guesses can't slip through); 'sign_in_succeeded'
// refunds it when the attempt turned out not to be a wrong password.
export async function consumeAuthRateLimit(action: AuthRateLimitAction, email: string): Promise<boolean> {
  const { data, error } = await createServiceSupabaseClient().rpc("consume_auth_rate_limit", {
    p_action: action,
    p_ip: await visitorIp(),
    p_email_key: emailKey(email),
  });
  if (error) {
    throw new Error(error.message);
  }
  return data === true;
}

// Gives back an attempt that turned out not to count (a sign-in that
// wasn't a wrong password; a sign-up Supabase refused without emailing).
// A refund must never turn a real outcome into an error page.
export async function refundAuthAttempt(action: "sign_in_succeeded" | "sign_up_failed", email: string): Promise<void> {
  try {
    await consumeAuthRateLimit(action, email);
  } catch (err) {
    console.error(`Couldn't record ${action}:`, err);
  }
}
