// Personal access token choices (SUP-53), shared by the Account page form and
// the server action that checks it. The crypto lives in access-tokens.ts.
export const TOKEN_NAME_MAX_LENGTH = 60;
export const MAX_ACTIVE_TOKENS = 10;
// Expiry choices; null means the token never expires.
export const TOKEN_LIFETIMES = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: null, label: "No expiry" },
] as const;
