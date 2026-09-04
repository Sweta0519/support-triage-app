"use client";

import { useActionState, useState } from "react";

import { publishSummaryAction, revokeShareAction } from "../actions";
import type { Share } from "@/app/lib/db/shares";
import { secondaryButtonClass } from "@/app/lib/styles";

export function SharePanel({
  ticketId,
  share,
  siteUrl,
  canPublish,
}: {
  ticketId: string;
  share: Share | null;
  siteUrl: string;
  // False until AI triage has produced a summary -- there's nothing to
  // publish before that.
  canPublish: boolean;
}) {
  const [state, action, pending] = useActionState(publishSummaryAction, undefined);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  function copyLink(url: string) {
    if (!navigator.clipboard?.writeText) {
      setCopyState("failed");
      setTimeout(() => setCopyState("idle"), 1500);
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() => setCopyState("copied"))
      .catch(() => setCopyState("failed"))
      .finally(() => setTimeout(() => setCopyState("idle"), 1500));
  }

  if (share) {
    const url = `${siteUrl}/s/${share.token}`;
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Published as a public status page -- anyone with this link can view the subject,
          status, and AI summary. No comments, no ticket body, no other tickets.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="rounded-md bg-black/[.05] px-2 py-1 text-xs dark:bg-white/[.08]">
            {url}
          </code>
          <button
            type="button"
            onClick={() => copyLink(url)}
            className={`${secondaryButtonClass} !px-3 !py-1 !text-xs`}
          >
            {copyState === "copied"
              ? "Copied"
              : copyState === "failed"
                ? "Couldn't copy -- select the link above"
                : "Copy link"}
          </button>
          <form action={revokeShareAction}>
            <input type="hidden" name="ticketId" value={ticketId} />
            <input type="hidden" name="shareId" value={share.id} />
            <button
              type="submit"
              className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              Unpublish
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        {canPublish
          ? "Publish a read-only public status page (subject, status, AI summary) to share outside the team."
          : "Publishing a public status page will be available once AI triage completes."}
      </p>
      {state?.error ? (
        <p className="text-xs text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <form action={action}>
        <input type="hidden" name="ticketId" value={ticketId} />
        <button
          type="submit"
          disabled={!canPublish || pending}
          className={`self-start ${secondaryButtonClass} !px-3 !py-1 !text-xs`}
        >
          Publish public status page
        </button>
      </form>
    </div>
  );
}
