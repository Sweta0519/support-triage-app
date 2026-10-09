"use client";

import { startTransition, useActionState, useState } from "react";

import { reviewTriageAction } from "../actions";
import {
  fieldLabel,
  TRIAGE_CATEGORIES,
  TRIAGE_PRIORITIES,
  TRIAGE_TEAMS,
} from "@/app/lib/triage-fields";
import { primaryButtonClass, secondaryButtonClass } from "@/app/lib/styles";

type Fields = { priority: string; category: string; team: string };

const FIELDS = [
  { name: "priority", label: "Priority", options: TRIAGE_PRIORITIES },
  { name: "category", label: "Category", options: TRIAGE_CATEGORIES },
  { name: "team", label: "Team", options: TRIAGE_TEAMS },
] as const;

// Staff confirm or correct the AI's priority / category / team. Starts from
// the ticket's current working values; the button reads "Confirm" while the
// selection still matches the AI run being reviewed, "Save correction" once
// it doesn't, so agreeing is one click and both are recorded.
export function TriageReviewForm({
  ticketId,
  resultId,
  ai,
  current,
}: {
  ticketId: string;
  // The triage run on screen, or null when there is none (failed / no key).
  resultId: string | null;
  ai: Fields | null;
  current: Fields;
}) {
  const [state, action, pending] = useActionState(reviewTriageAction, undefined);
  const [values, setValues] = useState<Fields>(current);

  // A new AI run (a Re-run, or the one a stale save was refused for) arrives
  // as a new resultId without remounting the form: restart from the values
  // now stored, so the old run's selection can't be saved back over it. A
  // message from before that run no longer applies and is hidden; one that
  // arrives with it (the stale refusal) is kept.
  const [seen, setSeen] = useState({ resultId, state });
  const [hiddenState, setHiddenState] = useState<typeof state>(undefined);
  if (resultId !== seen.resultId || state !== seen.state) {
    if (resultId !== seen.resultId) {
      setValues(current);
      if (state === seen.state) setHiddenState(state);
    }
    setSeen({ resultId, state });
  }
  const message = state === hiddenState ? undefined : state;

  const matchesAi =
    ai !== null &&
    values.priority === ai.priority &&
    values.category === ai.category &&
    values.team === ai.team;
  const complete = values.priority !== "" && values.category !== "" && values.team !== "";

  return (
    // Submitted through onSubmit rather than <form action>: React resets a
    // form after an action prop completes, which puts each select back to
    // its server-rendered option while `values` keeps the newer selection,
    // so the dropdowns would show (and the next submit would send) a value
    // other than the one on the button.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="resultId" value={resultId ?? ""} />

      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
        {FIELDS.map((field) => {
          const aiValue = ai?.[field.name] ?? "";
          const differs = ai !== null && aiValue !== "" && values[field.name] !== aiValue;
          return (
            <div key={field.name} className="contents">
              <label htmlFor={`review-${field.name}`} className="text-zinc-600 dark:text-zinc-400">
                {field.label}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  id={`review-${field.name}`}
                  name={field.name}
                  value={values[field.name]}
                  onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
                  className="rounded-lg border border-black/[.08] bg-white px-2 py-1 text-xs text-black dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
                >
                  {values[field.name] === "" ? <option value="">Choose...</option> : null}
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {fieldLabel(option)}
                    </option>
                  ))}
                </select>
                {differs ? (
                  <span className="text-zinc-400 dark:text-zinc-600">AI: {fieldLabel(aiValue)}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending || !complete}
          className={`${matchesAi ? primaryButtonClass : secondaryButtonClass} !px-4 !py-1.5 !text-xs`}
        >
          {pending
            ? "Saving..."
            : matchesAi
              ? "Confirm AI triage"
              : ai === null
                ? "Save triage"
                : "Save correction"}
        </button>
        {message && "error" in message ? (
          <p role="alert" className="text-xs text-red-700 dark:text-red-400">
            {message.error}
          </p>
        ) : message && "ok" in message ? (
          <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">
            {message.ok}
          </p>
        ) : null}
      </div>
    </form>
  );
}
