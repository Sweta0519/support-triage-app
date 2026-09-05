"use client";

import { useActionState } from "react";

import { createTicketAction } from "../actions";
import { inputClass, primaryButtonClass } from "@/app/lib/styles";

export function NewTicketForm() {
  const [state, action, pending] = useActionState(createTicketAction, undefined);

  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="subject" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Subject
        </label>
        <input id="subject" name="subject" type="text" placeholder="Subject" required className={inputClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Description
        </label>
        <textarea
          id="body"
          name="body"
          placeholder="Describe what's going on..."
          required
          rows={6}
          className={inputClass}
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button type="submit" disabled={pending} className={`self-start ${primaryButtonClass}`}>
        Submit ticket
      </button>
    </form>
  );
}
