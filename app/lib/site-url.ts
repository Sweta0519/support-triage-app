// The app's public address, for links the server builds (email
// confirmations, share pages, MCP tool results). Never from the request's
// Origin/Host headers (CLAUDE.md).
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
