import Link from "next/link";

import { linkClass } from "@/app/lib/styles";

// What /join and /invite show instead of the sign-up form (SUP-82): the link
// doesn't work, too many lookups from this visitor, or they're already signed in (one workspace per
// person, so a link is only for new accounts).
export function WorkspaceLinkNotice({ reason }: { reason: "signed-in" | "invalid" | "rate-limited" }) {
  const signedIn = reason === "signed-in";
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">
        {signedIn ? "You already have an account" : reason === "invalid" ? "This link isn't valid" : "Too many attempts"}
      </h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        {signedIn
          ? "Each account belongs to one workspace, so this link is for new accounts only."
          : reason === "invalid"
            ? "It may have been replaced, used already, or expired. Ask your team for a new one."
            : "Please wait a few minutes and open the link again."}
      </p>
      <Link href={signedIn ? "/" : "/login"} className={`text-sm ${linkClass}`}>
        {signedIn ? "Back to your workspace" : "Sign in instead"}
      </Link>
    </div>
  );
}
