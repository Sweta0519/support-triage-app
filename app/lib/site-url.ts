// The app's public address, for links the server builds (email
// confirmations, share pages, MCP tool results). Never from the request's
// Origin/Host headers (CLAUDE.md).
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// The same, for what the public pages show and link (metadata, the homepage's
// MCP setup): else Vercel's production domain, so a missing setting on Vercel
// never shows visitors a localhost address.
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
export const PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (vercelHost ? `https://${vercelHost}` : "http://localhost:3000");
