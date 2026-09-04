import { notFound } from "next/navigation";

import { getPublicSharedSummary } from "@/app/lib/db/shares";

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
  const share = await getPublicSharedSummary(token);

  if (!share) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 p-8">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-500">
        Support ticket status
      </p>
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">{share.subject}</h1>
      <span className="w-fit rounded-full border border-black/[.08] px-3 py-1 text-xs text-zinc-600 dark:border-white/[.145] dark:text-zinc-400">
        {share.status}
      </span>
      <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
        {share.summary}
      </p>
      <p className="text-xs text-zinc-400 dark:text-zinc-600">
        Shared by the support team as of {new Date(share.created_at).toLocaleString()}. This is a
        snapshot and does not update automatically.
      </p>
    </div>
  );
}
