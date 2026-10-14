"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { setLearningExcludedAction } from "../actions";
import { describeCorrection } from "@/app/lib/learning";
import { formatTicketNumber } from "@/app/lib/format";
import { linkClass } from "@/app/lib/styles";
import type { LearnedCorrection } from "@/app/lib/db/triage";

// "Learned from N past corrections" (SUP-43): the team's earlier
// corrections the AI was shown for this run. Staff see the ones they could
// open, linked, and a count for the rest; admins can stop the AI learning
// from a bad one (the review itself is untouched).
export function LearnedFrom({
  total,
  corrections,
  isAdmin,
}: {
  total: number;
  corrections: LearnedCorrection[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hidden = total - corrections.length;

  async function toggle(c: LearnedCorrection) {
    if (pending) return;
    setPending(c.ticket_id);
    const result = await setLearningExcludedAction(c.ticket_id, !c.excluded);
    setPending(null);
    setError(result.ok ? null : result.error);
    router.refresh();
  }

  return (
    <details className="text-xs text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer select-none">
        ✦ Learned from {total} past correction{total === 1 ? "" : "s"}
      </summary>
      <p className="mt-1 text-zinc-500 dark:text-zinc-500">
        How the team corrected the AI on similar tickets before. The AI was shown these as examples (summaries only).
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {corrections.map((c) => (
          <li key={c.ticket_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link href={`/tickets/${c.ticket_id}`} className={linkClass}>
              {formatTicketNumber(c.number)} {c.subject}
            </Link>
            <span className="text-zinc-500 dark:text-zinc-500">{describeCorrection(c.ai, c.corrected)}</span>
            {c.excluded ? <span className="text-amber-700 dark:text-amber-400">not used any more</span> : null}
            {isAdmin ? (
              <button
                type="button"
                onClick={() => toggle(c)}
                aria-disabled={pending !== null}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                {c.excluded ? "Learn from it again" : "Don't learn from this"}
              </button>
            ) : null}
          </li>
        ))}
        {hidden > 0 ? (
          <li className="text-zinc-500 dark:text-zinc-500">
            and {hidden} on {hidden === 1 ? "a ticket" : "tickets"} you can&apos;t open
          </li>
        ) : null}
      </ul>
      {error ? (
        <p role="alert" className="mt-1 text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </details>
  );
}
