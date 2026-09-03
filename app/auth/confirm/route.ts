import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

const OTP_TYPES: readonly EmailOtpType[] = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

// Only a same-origin path is ever used as the post-confirmation target.
// (1) Resolving against our own origin and comparing origins rejects
// anything cross-origin, including protocol-relative forms like
// "//evil.example" and "/\evil.example". (2) That is not enough on its own:
// a *same-origin* absolute URL can carry a pathname that itself begins with
// "//" -- `new URL("https://site//evil.example").pathname` is
// "//evil.example" -- and a Location header of just that pathname is read
// by browsers as protocol-relative and leaves the site. So the pathname
// must start with exactly one slash.
function safeNextPath(raw: string | null): string {
  if (!raw) {
    return "/";
  }
  let resolved: URL;
  try {
    resolved = new URL(raw, SITE_URL);
  } catch {
    return "/";
  }
  if (resolved.origin !== new URL(SITE_URL).origin) {
    return "/";
  }
  if (!/^\/(?![/\\])/.test(resolved.pathname)) {
    return "/";
  }
  return `${resolved.pathname}${resolved.search}`;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const type = OTP_TYPES.find((t) => t === rawType) ?? null;
  const next = safeNextPath(searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) {
      redirect(next);
    }
  }

  redirect("/login?error=confirmation-failed");
}
