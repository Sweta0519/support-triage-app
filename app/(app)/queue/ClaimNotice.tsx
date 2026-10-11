"use client";

import { useEffect } from "react";

// Shown once after a failed claim. The `notice` param is dropped from the
// address bar as soon as it's displayed, so a reload or Back doesn't bring
// the message back when nothing just went wrong.
export function ClaimNotice() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("notice")) {
      url.searchParams.delete("notice");
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
  }, []);
  return (
    <p
      role="status"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"
    >
      That ticket is no longer available to claim. Someone else may have claimed it. The queue below is up to date.
    </p>
  );
}
