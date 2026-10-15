"use client";

import { useState, useTransition } from "react";

import { decideAccessRequestAction } from "@/app/(app)/admin/actions";
import { secondaryButtonClass } from "@/app/lib/styles";

// Grant or decline one access request (SUP-68), on the Access requests page
// and on the request's ticket. Each takes a second click to confirm, because
// granting changes someone's role and both reply to them.
export function AccessRequestActions({ userId, name }: { userId: string; name: string }) {
  const [confirming, setConfirming] = useState<"grant" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function decide(grant: boolean) {
    start(async () => {
      try {
        const result = await decideAccessRequestAction(userId, grant);
        if (result.ok) {
          setDone(result.outcome === "granted" ? `${name} is now an agent.` : `Declined. ${name} has been told.`);
          setError(null);
        } else {
          setError(result.error);
        }
      } catch {
        setError("That didn't work. Try again.");
      }
      setConfirming(null);
    });
  }

  if (done) {
    return (
      <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
        {done}
      </p>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => decide(confirming === "grant")}
            className={
              confirming === "grant"
                ? "rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                : "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
            }
          >
            {pending ? "Saving…" : confirming === "grant" ? `Make ${name} an agent` : `Decline ${name}'s request`}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(null)}
            className="text-sm text-zinc-600 underline underline-offset-2 dark:text-zinc-400"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setConfirming("grant")} className={secondaryButtonClass}>
            Grant agent access…
          </button>
          <button type="button" onClick={() => setConfirming("decline")} className={secondaryButtonClass}>
            Decline…
          </button>
        </div>
      )}
      {confirming ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {confirming === "grant"
            ? "They become an agent straight away, get a reply on their request, and the request is resolved."
            : "They stay a customer, get a polite reply on their request, and the request is resolved."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
