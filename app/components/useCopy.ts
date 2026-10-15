"use client";

import { useEffect, useState } from "react";

// Copy-to-clipboard with feedback: "copied" or "failed" for two seconds,
// then back to idle. Shared by the copy buttons that sit side by side on
// the Account page (the token, and the MCP setup), so they behave alike.
export type CopyState = "idle" | "copied" | "failed";

export function useCopy(): [CopyState, (text: string) => Promise<void>, () => void] {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // No clipboard access (permission, or an insecure page): say so; the
      // text is still on screen to select.
      setState("failed");
    }
  }

  return [state, copy, () => setState("idle")];
}
