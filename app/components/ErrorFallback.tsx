"use client";

import Link from "next/link";
import { useEffect } from "react";

// What error.tsx shows instead of Next's "This page couldn't load" (SUP-75).
// Often a click whose Server Action was refused (the Vercel firewall's 429,
// docs/security/vercel-waf.md) or a dropped connection, but any error lands
// here, so it names those only as likely. The error itself is never shown;
// its digest (production's only detail) is, to match the server logs.
export function ErrorFallback({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-lg font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
        !
      </span>
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Something went wrong</h1>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-500">
        Often it&apos;s too many requests at once, or a dropped connection. Wait a moment and try again.
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
      {error.digest ? <p className="text-xs text-zinc-400 dark:text-zinc-600">Reference: {error.digest}</p> : null}
    </div>
  );
}
