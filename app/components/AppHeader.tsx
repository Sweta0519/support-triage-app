import Link from "next/link";

import { signOutAction } from "@/app/lib/auth/actions";
import { roleBadgeClasses } from "@/app/lib/badges";
import type { Profile } from "@/app/lib/db/profiles";

// Nav links and Sign out share this exact pill shape so the whole header
// reads as one row of buttons -- no plain, un-boxed link text next to them.
const navButtonClasses =
  "rounded-full border border-black/[.08] px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-black/[.05] dark:border-white/[.145] dark:text-zinc-300 dark:hover:bg-white/[.06]";

export function AppHeader({ profile }: { profile: Profile }) {
  const initial = profile.email.charAt(0).toUpperCase();

  return (
    <header className="sticky top-0 z-10 border-b border-black/[.08] bg-[var(--background)] dark:border-white/[.145]">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-semibold tracking-tight text-black dark:text-zinc-50"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">
              S
            </span>
            Support Triage
          </Link>
          <nav className="hidden items-center gap-2 sm:flex">
            {profile.role === "customer" ? (
              <Link href="/tickets" className={navButtonClasses}>
                My tickets
              </Link>
            ) : (
              <>
                <Link href="/queue" className={navButtonClasses}>
                  Queue
                </Link>
                <Link href="/notes" className={navButtonClasses}>
                  Notes
                </Link>
                {profile.role === "admin" ? (
                  <Link href="/admin" className={navButtonClasses}>
                    Admin
                  </Link>
                ) : null}
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
              {initial}
            </span>
            <div className="hidden flex-col leading-tight sm:flex">
              <span className="text-xs font-medium text-black dark:text-zinc-50">
                {profile.email}
              </span>
              <span
                className={`w-fit rounded-full px-1.5 py-0 text-[10px] font-medium capitalize ${roleBadgeClasses(profile.role)}`}
              >
                {profile.role}
              </span>
            </div>
          </div>
          <Link href="/account" className={navButtonClasses}>
            Account
          </Link>
          <form action={signOutAction}>
            <button type="submit" className={navButtonClasses}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
