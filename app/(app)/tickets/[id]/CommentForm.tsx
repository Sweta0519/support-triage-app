"use client";

import { useActionState, useRef } from "react";

import { addCommentAction } from "../actions";

export function CommentForm({
  ticketId,
  isStaff,
  draft = null,
}: {
  ticketId: string;
  isStaff: boolean;
  // The AI's suggested reply, staff-only. It only ever pre-fills the
  // textarea -- a human still edits and clicks "Add comment", so nothing
  // the model wrote reaches a customer without an agent's action.
  draft?: string | null;
}) {
  const [state, action, pending] = useActionState(addCommentAction, undefined);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  function fillDraft() {
    if (bodyRef.current && draft) {
      bodyRef.current.value = draft;
      bodyRef.current.focus();
    }
  }

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <textarea
        ref={bodyRef}
        name="body"
        placeholder="Write a comment..."
        required
        rows={3}
        className="rounded-lg border border-black/[.08] bg-white px-4 py-2 text-sm text-black outline-none focus:border-black/30 dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus:border-white/30"
      />
      <div className="flex flex-wrap items-center gap-3">
        {isStaff ? (
          <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <input type="checkbox" name="isInternal" />
            Internal note (not visible to the customer)
          </label>
        ) : null}
        {isStaff && draft ? (
          <button
            type="button"
            onClick={fillDraft}
            className="text-xs underline text-zinc-600 dark:text-zinc-400"
          >
            Use suggested reply
          </button>
        ) : null}
      </div>
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        Add comment
      </button>
    </form>
  );
}
