"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { dismissIncidentAction, postIncidentUpdateAction, resolveIncidentAction, type IncidentActionResult } from "../actions";
import { formatRelativeTime } from "@/app/lib/format";
import { INCIDENT_UPDATE_MAX_LENGTH } from "@/app/lib/incidents";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/app/lib/styles";

// The incident's actions (SUP-42). Nothing happens without a click, and the
// update and resolve-all ask for a second click before they touch several
// tickets at once.
export function IncidentActions({
  incidentId,
  draft,
  openTicketCount,
  updatePostedAt,
}: {
  incidentId: string;
  draft: string;
  openTicketCount: number;
  updatePostedAt: string | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState(draft);
  const [confirming, setConfirming] = useState<"post" | "resolve" | null>(null);
  const [alsoResolve, setAlsoResolve] = useState(true);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<IncidentActionResult | null>(null);

  async function run(action: () => Promise<IncidentActionResult>) {
    if (pending) return;
    setPending(true);
    try {
      setResult(await action());
    } finally {
      setPending(false);
      setConfirming(null);
      router.refresh();
    }
  }

  const plural = (n: number) => `${n} ticket${n === 1 ? "" : "s"}`;

  return (
    <section aria-labelledby="incident-update" className="flex flex-col gap-3 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <h2 id="incident-update" className="text-sm font-semibold text-black dark:text-zinc-50">
        Update every affected customer
      </h2>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        ✦ Drafted by AI with no customer-specific details -- edit it before posting. It goes out as a reply on each open ticket
        you can see ({plural(openTicketCount)}).
        {updatePostedAt ? ` An update was last posted ${formatRelativeTime(updatePostedAt)}.` : ""}
      </p>
      <label className="sr-only" htmlFor="incident-update-body">
        Update text
      </label>
      <textarea
        id="incident-update-body"
        value={body}
        maxLength={INCIDENT_UPDATE_MAX_LENGTH}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className={inputClass}
        placeholder="We're aware of the problem and are investigating. We'll update you here."
      />
      <div className="flex flex-wrap items-center gap-2">
        {confirming === "post" ? (
          <>
            <button
              type="button"
              disabled={pending || !body.trim()}
              onClick={() => run(() => postIncidentUpdateAction(incidentId, body))}
              className={`${primaryButtonClass} !px-3 !py-1 !text-xs`}
            >
              Post to {plural(openTicketCount)}
            </button>
            <button type="button" onClick={() => setConfirming(null)} className={`${secondaryButtonClass} !px-3 !py-1 !text-xs`}>
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={pending || !body.trim() || openTicketCount === 0}
            onClick={() => setConfirming("post")}
            className={`${primaryButtonClass} !px-3 !py-1 !text-xs`}
          >
            Post update…
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-black/[.08] pt-3 dark:border-white/[.145]">
        {confirming === "resolve" ? (
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
              <input type="checkbox" checked={alsoResolve} onChange={(e) => setAlsoResolve(e.target.checked)} />
              Also resolve its tickets that are in progress
            </label>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => resolveIncidentAction(incidentId, alsoResolve))}
              className={`${primaryButtonClass} !px-3 !py-1 !text-xs`}
            >
              Resolve incident
            </button>
            <button type="button" onClick={() => setConfirming(null)} className={`${secondaryButtonClass} !px-3 !py-1 !text-xs`}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming("resolve")}
              className={`${secondaryButtonClass} !px-3 !py-1 !text-xs`}
            >
              Resolve…
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => dismissIncidentAction(incidentId))}
              className={`${secondaryButtonClass} !px-3 !py-1 !text-xs`}
            >
              Not one problem -- dismiss
            </button>
          </div>
        )}
      </div>

      {result ? (
        <p role={result.ok ? "status" : "alert"} className={`text-xs ${result.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
    </section>
  );
}
