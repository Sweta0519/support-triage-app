import Link from "next/link";

import { linkClass } from "@/app/lib/styles";

// What /join and /invite show instead of the sign-up form (SUP-82): the link
// doesn't work, or the visitor is already signed in (one workspace per
// person, so a link is only for new accounts).
export function WorkspaceLinkNotice({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
        {signedIn ? "You already have an account" : "This link isn't valid"}
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        {signedIn
          ? "Each account belongs to one workspace, so this link is for new accounts only."
          : "It may have been replaced, used already, or expired. Ask your team for a new one."}
      </p>
      <Link href={signedIn ? "/" : "/login"} className={`text-sm ${linkClass}`}>
        {signedIn ? "Back to your workspace" : "Sign in instead"}
      </Link>
    </div>
  );
}
