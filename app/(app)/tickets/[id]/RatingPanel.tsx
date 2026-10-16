"use client";

import { useState } from "react";

import { rateTicketAction } from "../actions";
import { Stars } from "@/app/components/Stars";
import { RATING_COMMENT_MAX_LENGTH } from "@/app/lib/ratings";
import { inputClass, primaryButtonClass } from "@/app/lib/styles";
import { useSafeActionState } from "@/app/components/useSafeActionState";

const STARS = [1, 2, 3, 4, 5] as const;
const WORDS = ["", "Very poor", "Poor", "Okay", "Good", "Excellent"];

// The customer's CSAT prompt on a resolved ticket. While the ticket is
// resolved the rating can be given or changed; once it's closed it's shown
// read-only.
export function RatingPanel({
  ticketId,
  rating,
  editable,
}: {
  ticketId: string;
  rating: { score: number; comment: string | null } | null;
  editable: boolean;
}) {
  const [state, action, pending, formRef] = useSafeActionState(rateTicketAction, undefined);
  const [score, setScore] = useState(rating?.score ?? 0);

  if (!editable) {
    if (!rating) return null;
    return (
      <section className="flex flex-col gap-1 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">Your rating</h2>
        <p className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <Stars score={rating.score} className="text-lg" />
          <span aria-hidden>{rating.score} of 5 · {WORDS[rating.score]}</span>
        </p>
        {rating.comment ? <p className="text-sm text-zinc-600 dark:text-zinc-400">“{rating.comment}”</p> : null}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
      <div>
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
          {rating ? "Your rating" : "How did we do?"}
        </h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Your ticket is resolved. Rate the help you got{rating ? " (you can still change it)" : ""}.
        </p>
      </div>
      <form ref={formRef} action={action} className="flex flex-col gap-3">
        <input type="hidden" name="ticketId" value={ticketId} />
        <fieldset className="flex items-center gap-1">
          <legend className="sr-only">Rating from 1 to 5 stars</legend>
          {STARS.map((n) => (
            <label key={n} className="cursor-pointer">
              <input
                type="radio"
                name="score"
                value={n}
                checked={score === n}
                onChange={() => setScore(n)}
                className="peer sr-only"
                aria-label={`${n} star${n === 1 ? "" : "s"}: ${WORDS[n]}`}
              />
              <span
                aria-hidden
                className={`rounded px-0.5 text-2xl leading-none transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400 ${
                  n <= score ? "text-amber-500" : "text-zinc-300 hover:text-amber-300 dark:text-zinc-700"
                }`}
              >
                ★
              </span>
            </label>
          ))}
          <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{score ? WORDS[score] : ""}</span>
        </fieldset>
        <textarea
          name="comment"
          aria-label="Comment (optional)"
          placeholder="Anything we could have done better? (optional)"
          maxLength={RATING_COMMENT_MAX_LENGTH}
          defaultValue={rating?.comment ?? ""}
          rows={2}
          className={inputClass}
        />
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={pending || score === 0} className={`${primaryButtonClass} !px-4 !py-1.5 !text-xs`}>
            {pending ? "Sending…" : rating ? "Update rating" : "Send rating"}
          </button>
          {/* Always rendered, so screen readers announce the message when it
              appears (a live region inserted already filled often isn't). */}
          <p
            role="status"
            aria-live="polite"
            className={`text-xs ${
              state && "error" in state ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"
            }`}
          >
            {state && "ok" in state ? state.ok : state && "error" in state ? state.error : ""}
          </p>
        </div>
      </form>
    </section>
  );
}
