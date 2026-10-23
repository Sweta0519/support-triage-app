"use client";

import { useState, useTransition } from "react";

import { currentPresenceAction, setPresenceAction } from "@/app/(app)/account/actions";
import { FAILED_MESSAGE, orFailed } from "@/app/components/useSafeActionState";
import { PRESENCE_DOT, PRESENCES, type Presence } from "@/app/lib/presence";

// The Online / Away / Offline dropdown under a staff member's name in the
// sidebar (SUP-76). A native <select>, so keyboard and screen readers work
// as everywhere else; the coloured dot beside it carries the state. The
// choice shows at once and is kept in this component's state: nothing else
// on the page shows it, so the action doesn't re-render the layout.
export function PresenceSelect({ presence }: { presence: Presence }) {
  const [shown, setShown] = useState(presence);
  const [seen, setSeen] = useState(presence);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // A new value from the server (another tab changed it) wins.
  if (presence !== seen) {
    setSeen(presence);
    setShown(presence);
  }

  function change(next: Presence) {
    const previous = shown;
    setShown(next);
    setError(null);
    startTransition(async () => {
      const result = await orFailed(setPresenceAction(next));
      if (result.ok) return;
      setError(result.error);
      if (result.error !== FAILED_MESSAGE) {
        // A refusal: nothing was saved.
        setShown(previous);
        return;
      }
      // No answer: the change may still have been saved, so show what the
      // server holds now (or the old value, if that can't be read either).
      const now = await currentPresenceAction().catch(() => previous);
      setShown(now);
      if (now === next) setError(null);
    });
  }

  return (
    <div className="flex flex-col">
      <label className="flex w-fit items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400">
        <span
          aria-hidden="true"
          data-testid="presence-dot"
          className={`h-2 w-2 shrink-0 rounded-full ${PRESENCE_DOT[shown]}`}
        />
        <span className="sr-only">Your status</span>
        <select
          value={shown}
          aria-busy={pending}
          onChange={(e) => change(e.target.value as Presence)}
          className="-ml-0.5 cursor-pointer rounded bg-transparent py-0 pr-0.5 text-[11px] font-medium text-zinc-600 hover:text-black focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          {(Object.keys(PRESENCES) as Presence[]).map((p) => (
            <option key={p} value={p}>
              {PRESENCES[p]}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="mt-1 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
