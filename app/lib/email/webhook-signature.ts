import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

// Resend signs its webhooks the Svix way (docs/email.md): the signed content
// is "<svix-id>.<svix-timestamp>.<raw body>", HMAC-SHA256 with the
// base64-decoded part of the secret after "whsec_", base64-encoded. The
// svix-signature header lists one or more "v1,<signature>" entries,
// space-separated (more than one while a secret is being rotated).

// How far svix-timestamp may be from our clock. Older deliveries are
// refused, so a captured request can't be replayed later; the svix-id
// recorded per delivery stops replays inside the window.
export const TOLERANCE_SECONDS = 5 * 60;

export type SignatureHeaders = { id: string | null; timestamp: string | null; signature: string | null };

export function verifyWebhookSignature(
  secret: string,
  headers: SignatureHeaders,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature || !secret.startsWith("whsec_")) return false;
  if (!/^\d{1,12}$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();

  return signature.split(" ").some((entry) => {
    const [version, value] = entry.split(",", 2);
    if (version !== "v1" || !value) return false;
    const given = Buffer.from(value, "base64");
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
