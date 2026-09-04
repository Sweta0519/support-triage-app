import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getPublicSharedSummary, PublicShareRateLimitError } from "@/app/lib/db/shares";
import { Badge } from "@/app/components/Badge";
import { statusBadgeClasses, statusLabel } from "@/app/lib/badges";

// Deliberately outside the (app) route group: this page has no signed-in
// user at all. It renders exactly one thing -- the snapshot behind this
// token -- and links nowhere else in the app, so an anonymous visitor
// following a shared link has no path from here into anything else.
export default async function SharedStatusPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // Vercel sets x-forwarded-for at the edge for every request reaching this
  // function; it isn't attacker-overridable the way it would be on a
  // self-hosted origin behind no proxy. Used only as a rate-limit bucket
  // key, never for anything security-sensitive beyond that.
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  let share;
  try {
    share = await getPublicSharedSummary(token, ip);
  } catch (err) {
    if (err instanceof PublicShareRateLimitError) {
      return (
        <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 dark:bg-black">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Too many requests. Please try again in a few minutes.
          </p>
        </div>
      );
    }
    throw err;
  }

  if (!share) {
    notFound();
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-black">
      <div className="flex w-full max-w-lg flex-col items-center gap-6">
        <div className="flex items-center gap-2 text-base font-semibold tracking-tight text-black dark:text-zinc-50">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">
            S
          </span>
          Support Triage
        </div>
        <div className="w-full rounded-2xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.08] dark:bg-zinc-950">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
            Ticket status
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold text-black dark:text-zinc-50">{share.subject}</h1>
            <Badge label={statusLabel(share.status)} colorClasses={statusBadgeClasses(share.status)} />
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
            {share.summary}
          </p>
          <p className="mt-6 border-t border-black/[.08] pt-4 text-xs text-zinc-400 dark:border-white/[.08] dark:text-zinc-600">
            Shared by the support team as of {new Date(share.created_at).toLocaleString()}. This
            is a snapshot and does not update automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
