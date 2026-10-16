"use client";

import Link from "next/link";

// What error.tsx shows instead of Next's "This page couldn't load" (SUP-75).
// The usual cause is a click whose Server Action was refused before it ran:
// the Vercel firewall's 429 (docs/security/vercel-waf.md) or a dropped
// connection. The message never shows the error itself: in production it's
// only a digest.
export function ErrorFallback({ retry }: { retry: () => void }) {
  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-lg font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        !
      </span>
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">That didn&apos;t go through</h1>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-500">
        There may have been too many requests, or the connection dropped. Wait a moment and try again.
      </p>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => retry()}
          className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Try again
        </button>
        <Link href="/" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          Back to home
        </Link>
      </div>
    </div>
  );
}
