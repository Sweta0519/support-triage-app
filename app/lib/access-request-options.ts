// The "Request access" questions (SUP-58), shared by the sign-up form and the
// action that checks them. ticketing.file_access_request() caps them the same
// way (100 and 2000 characters, size 20).
export const ACCESS_TEAM_MAX = 100;
export const ACCESS_PURPOSE_MAX = 2000;
// The subject ticketing.file_access_request() gives the ticket ("Access
// request" or "Access request: <team>").
export const ACCESS_REQUEST_SUBJECT = "Access request";
export const TEAM_SIZES = ["1-5", "6-20", "21-100", "100+"] as const;

export type AccessRequestAnswers = { team: string; size: string; purpose: string };

// The answers from the sign-up form, when it came from "Request access" (its
// hidden access=1 field): all optional, trimmed and capped, with an unknown
// size dropped. Null for a plain sign-up.
export function parseAccessRequest(formData: FormData): AccessRequestAnswers | null {
  if (formData.get("access") !== "1") return null;
  const size = String(formData.get("size") ?? "");
  return {
    team: String(formData.get("team") ?? "").trim().slice(0, ACCESS_TEAM_MAX),
    size: (TEAM_SIZES as readonly string[]).includes(size) ? size : "",
    purpose: String(formData.get("purpose") ?? "").trim().slice(0, ACCESS_PURPOSE_MAX),
  };
}
