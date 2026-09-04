"use client";

import { useActionState, useRef } from "react";

import { addCommentAction } from "../actions";
import { inputClass, primaryButtonClass } from "@/app/lib/styles";

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
        className={inputClass}
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
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
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
        className={`self-start ${primaryButtonClass} !px-4 !py-1.5 !text-xs`}
      >
        Add comment
      </button>
    </form>
  );
}
