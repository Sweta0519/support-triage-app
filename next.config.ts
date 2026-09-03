import type { NextConfig } from "next";

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
};

export default nextConfig;
