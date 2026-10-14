"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { setLearningExcludedAction } from "../actions";
import { describeCorrection, type TriageValues } from "@/app/lib/learning";
import { formatTicketNumber } from "@/app/lib/format";
import { linkClass } from "@/app/lib/styles";

export type LearnedExample = {
  ticket_id: string;
  // As the AI was shown it (a snapshot from the run).
  ai: TriageValues;
  corrected: TriageValues;
  // From the viewer's own RLS: null when they can't open that ticket, or
  // it's gone.
  ticket: { number: number; subject: string; excluded: boolean; reviewer: string | null } | null;
};

// "Used N past corrections as examples" (SUP-43): the team's earlier
// corrections the AI was shown for this run, as they were then. Staff see
// the tickets they could open, linked, with who made the correction; the
// rest are counted. Admins can stop the AI learning from a bad one (the
// review itself is untouched).
export function LearnedFrom({ examples, isAdmin }: { examples: LearnedExample[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const visible = examples.filter((e) => e.ticket);
  const hidden = examples.length - visible.length;

  async function toggle(e: LearnedExample) {
    if (pending || !e.ticket) return;
    setPending(e.ticket_id);
    try {
      const result = await setLearningExcludedAction(e.ticket_id, !e.ticket.excluded);
      setError(result.ok ? null : result.error);
      router.refresh();
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <details className="text-xs text-zinc-600 dark:text-zinc-400">
      <summary className="cursor-pointer select-none">
        ✦ Used {examples.length} past correction{examples.length === 1 ? "" : "s"} as examples
      </summary>
      <p className="mt-1 text-zinc-500 dark:text-zinc-500">
        How the team corrected the AI on similar tickets before, as the AI was shown them (summaries only).
      </p>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {visible.map((e) => (
          <li key={e.ticket_id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Link href={`/tickets/${e.ticket_id}`} className={linkClass}>
              {formatTicketNumber(e.ticket!.number)} {e.ticket!.subject}
            </Link>
            <span className="text-zinc-500 dark:text-zinc-500">
              {describeCorrection(e.ai, e.corrected)}
              {e.ticket!.reviewer ? ` · by ${e.ticket!.reviewer}` : ""}
            </span>
            {e.ticket!.excluded ? <span className="text-amber-700 dark:text-amber-400">not used any more</span> : null}
            {isAdmin ? (
              <button
                type="button"
                onClick={() => toggle(e)}
                aria-disabled={pending !== null}
                className="rounded-md px-1.5 py-0.5 text-[11px] text-zinc-500 underline underline-offset-2 hover:text-zinc-800 aria-disabled:opacity-50 dark:hover:text-zinc-200"
              >
                {pending === e.ticket_id ? "Saving…" : e.ticket!.excluded ? "Learn from it again" : "Don't learn from this"}
              </button>
            ) : null}
          </li>
        ))}
        {hidden > 0 ? (
          <li className="text-zinc-500 dark:text-zinc-500">
            and {hidden} more on {hidden === 1 ? "a ticket" : "tickets"} you can&apos;t open, or that no longer exist
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
