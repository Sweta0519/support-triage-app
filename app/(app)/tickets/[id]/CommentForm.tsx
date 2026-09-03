"use client";

import { useActionState } from "react";

import { addCommentAction } from "../actions";

export function CommentForm({
  ticketId,
  isStaff,
}: {
  ticketId: string;
  isStaff: boolean;
}) {
  const [state, action, pending] = useActionState(addCommentAction, undefined);

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="ticketId" value={ticketId} />
      <textarea
        name="body"
        placeholder="Write a comment..."
        required
        rows={3}
        className="rounded-lg border border-black/[.08] bg-white px-4 py-2 text-sm text-black outline-none focus:border-black/30 dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus:border-white/30"
      />
      {isStaff ? (
        <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" name="isInternal" />
          Internal note (not visible to the customer)
        </label>
      ) : null}
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
