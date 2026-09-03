"use client";

import { useActionState } from "react";

import { createTicketAction } from "../actions";

export function NewTicketForm() {
  const [state, action, pending] = useActionState(createTicketAction, undefined);

  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <input
        name="subject"
        type="text"
        placeholder="Subject"
        required
        className="rounded-lg border border-black/[.08] bg-white px-4 py-2 text-black outline-none focus:border-black/30 dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus:border-white/30"
      />
      <textarea
        name="body"
        placeholder="Describe what's going on..."
        required
        rows={6}
        className="rounded-lg border border-black/[.08] bg-white px-4 py-2 text-black outline-none focus:border-black/30 dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus:border-white/30"
      />
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        Submit ticket
      </button>
    </form>
  );
}
