import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

// Next's inline bootstrap scripts need 'unsafe-inline' for script-src
// without a per-request nonce; dev additionally needs 'unsafe-eval' for
// React Fast Refresh. Everything else is locked to same-origin. The browser
// never talks to Supabase or OpenRouter directly (all data access is via
// Server Actions / server components), so connect-src stays 'self'.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Server Actions already reject requests whose Origin doesn't match
      // the request Host (built-in CSRF check). This pins the production
      // domain explicitly so that check keeps working if the app is ever
      // fronted by a proxy or custom domain whose Host header differs.
      allowedOrigins: ["support-triage-app-one.vercel.app"],
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
