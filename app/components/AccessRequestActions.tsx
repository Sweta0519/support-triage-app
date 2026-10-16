"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { decideAccessRequestAction } from "@/app/(app)/admin/actions";
import { secondaryButtonClass } from "@/app/lib/styles";

// Grant or decline one access request (SUP-68), on the Access requests page
// and on the request's ticket. Each takes a second click to confirm, because
// granting changes someone's role and both reply to them.
// `alreadyStaff`: they're an agent or admin already, so granting just closes
// the request (their role isn't changed).
export function AccessRequestActions({ userId, name, alreadyStaff = false }: { userId: string; name: string; alreadyStaff?: boolean }) {
  const [confirming, setConfirming] = useState<"grant" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  // After a decision, refresh the page (the sidebar count, the lists, the
  // ticket) once the confirmation has had a moment to be seen and read.
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => router.refresh(), 2500);
    return () => clearTimeout(timer);
  }, [done, router]);

  function decide(grant: boolean) {
    start(async () => {
      try {
        const result = await decideAccessRequestAction(userId, grant);
        if (result.ok) {
          setDone(
            result.outcome === "declined"
              ? `Closed. A reply is on ${name}'s ticket.`
              : alreadyStaff
                ? `Closed. ${name} already had staff access.`
                : `${name} is now an agent.`
          );
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
            {pending
              ? "Saving…"
              : confirming === "grant"
                ? alreadyStaff
                  ? `Close ${name}'s request`
                  : `Make ${name} an agent`
                : `Close ${name}'s request with a reply`}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(null)}
            className="text-sm text-zinc-600 underline underline-offset-2 disabled:opacity-50 dark:text-zinc-400"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setConfirming("grant")} className={secondaryButtonClass}>
            {alreadyStaff ? "Close as granted…" : "Add to our team as an agent…"}
          </button>
          <button type="button" onClick={() => setConfirming("decline")} className={secondaryButtonClass}>
            Close request…
          </button>
        </div>
      )}
      {confirming ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {confirming === "grant"
            ? alreadyStaff
              ? "Their role stays as it is. They get a reply on their request, and the request is resolved."
              : "They join our support team as an agent straight away: they'll see and work our team's tickets, like any agent. Only do this for someone joining our team."
            : "They stay a customer, get a polite reply on their ticket, and the request is closed."}
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
