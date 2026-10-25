import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { AUTH_COOKIE_OPTIONS } from "./clients";

const PUBLIC_PATHS = ["/login", "/signup", "/join/", "/invite/", "/auth/confirm", "/s/", "/privacy"];
// Exact, unlike the prefixes above, so a later /welcome-something route
// isn't public by accident.
const PUBLIC_EXACT = ["/welcome"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  const isPublicPath =
    PUBLIC_EXACT.includes(request.nextUrl.pathname) ||
    PUBLIC_PATHS.some((path) => request.nextUrl.pathname.startsWith(path));

  // Session refresh + "is anyone signed in" only. Role/authorization checks
  // must never live here -- Next's proxy is not an authorization layer, so
  // per-role gating happens in requireRole()/requireStaff()/requireAdmin()
  // (app/lib/auth/session.ts) and in RLS, not here.

  // The public homepage (SUP-48). A visitor at the site root with no sign-in
  // cookie at all sees the marketing page under the same URL. Like the
  // redirect below, this only asks "is anyone signed in". A visitor who has
  // a session cookie that didn't check out (expired, or a transient error)
  // still goes to /login below, as before, rather than to the marketing page.
  const hasSessionCookie = request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"));
  if (!data && !hasSessionCookie && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    const rewrite = NextResponse.rewrite(url, { request });
    response.cookies.getAll().forEach((cookie) => rewrite.cookies.set(cookie));
    return rewrite;
  }

  if (!data && !isPublicPath) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
