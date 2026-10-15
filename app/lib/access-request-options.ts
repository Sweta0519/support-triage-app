// The "Request access" questions (SUP-58), shared by the sign-up form and the
// action that checks them. ticketing.file_access_request() caps them the same
// way (100 and 2000 characters, size 20).
export const ACCESS_TEAM_MAX = 100;
export const ACCESS_PURPOSE_MAX = 2000;
export const TEAM_SIZES = ["1-5", "6-20", "21-100", "100+"] as const;

export type AccessRequestAnswers = { team: string; size: string; purpose: string };
