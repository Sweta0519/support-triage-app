// Personal access token choices (SUP-53), shared by the Account page form and
// the server action that checks it. The database enforces the same limits
// (20261015020000_access_tokens_create_rpc.sql): keep them in step.
export const TOKEN_NAME_MAX_LENGTH = 60;
// Enforced by ticketing.access_tokens_before_insert().
export const MAX_ACTIVE_TOKENS = 10;
// Expiry choices; null means the token never expires. ticketing.create_access_token()
// accepts only these.
export const TOKEN_LIFETIMES = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
  { days: null, label: "No expiry" },
] as const;
