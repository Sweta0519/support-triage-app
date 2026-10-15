import "server-only";

import { createHash, randomBytes } from "node:crypto";

// Personal access tokens for the MCP connector (SUP-53). A token is "st_"
// plus 43 base64url characters (32 random bytes); only its SHA-256 hash is
// stored. The first 11 characters ("st_" + 8) are kept as a visible prefix so
// owners can tell their tokens apart.

export function generateAccessToken(): { token: string; prefix: string; hash: string } {
  const token = `st_${randomBytes(32).toString("base64url")}`;
  return { token, prefix: token.slice(0, 11), hash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
