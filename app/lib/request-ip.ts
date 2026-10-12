import "server-only";

import { headers } from "next/headers";

// The visitor's IP, for rate-limit bucket keys only (sign-in/sign-up and
// the public share page). Shared so the trust rules live in one place.

const LOOPBACK = new Set(["::1", "127.0.0.1", "::ffff:127.0.0.1"]);

// The visitor's IP. This app runs on Vercel, which sets x-forwarded-for at
// the edge from the real connection (a client can't supply it there; on a
// host that appends to a client-sent header instead, the first entry would
// be spoofable). IPv6 is grouped by /64 -- one household or server usually
// holds a whole /64, so per-address buckets would be unlimited.
//
// Local development has no real visitor IP (no header, or the dev server's
// loopback address): null, no per-IP bucket, so the test suite's many
// sign-ins from one machine aren't throttled. In production a missing
// header falls into one shared, strict "unknown" bucket.
export async function visitorIp(): Promise<string | null> {
  const forwarded = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  if (process.env.NODE_ENV !== "production" && (!forwarded || LOOPBACK.has(forwarded))) {
    return null;
  }
  if (!forwarded) return "unknown";
  return forwarded.includes(":") ? ipv6Prefix64(forwarded) : forwarded;
}

function ipv6Prefix64(ip: string): string {
  const [head, tail = ""] = ip.split("%")[0].split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::")
    ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right]
    : left;
  return `${groups.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":")}::/64`;
}
