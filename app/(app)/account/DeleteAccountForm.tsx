"use client";

import { useActionState } from "react";

import { deleteAccountAction } from "./actions";
import { inputClass } from "@/app/lib/styles";

const dangerButtonClass =
  "rounded-full bg-red-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-50";

// A typed confirmation instead of window.confirm(): it works without a
// browser dialog, and typing the address makes the action deliberate.
export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(deleteAccountAction, undefined);

  return (
    <form action={action} className="flex w-full flex-col gap-3">
      <label htmlFor="confirm" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
        Type <span className="font-mono text-zinc-800 dark:text-zinc-200">{email}</span> to confirm
      </label>
      <input
        id="confirm"
        name="confirm"
        type="email"
        autoComplete="off"
        placeholder="your@email.com"
        required
        className={inputClass}
      />
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button type="submit" disabled={pending} className={`self-start ${dangerButtonClass}`}>
        {pending ? "Deleting..." : "Delete my account"}
      </button>
    </form>
  );
}
