"use client";

import Link from "next/link";

import { useSafeActionState } from "@/app/components/useSafeActionState";
import { signInAction } from "@/app/lib/auth/actions";
import { inputClass, linkClass, primaryButtonClass } from "@/app/lib/styles";

export function LoginForm() {
  const [state, action, pending, formRef] = useSafeActionState(signInAction, undefined);

  return (
    <form ref={formRef} action={action} className="flex w-full flex-col gap-4">
      <input name="email" type="email" placeholder="Email" required className={inputClass} />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        className={inputClass}
      />
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
        Sign in
      </button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        New team?{" "}
        <Link href="/signup" className={linkClass}>
          Create a workspace
        </Link>
      </p>
      {/* A plain sign-up makes a new workspace (SUP-82): customers and agents
          join theirs through the link their team gives them. */}
      <p className="-mt-2 text-center text-xs text-zinc-500 dark:text-zinc-500">
        Joining your team or contacting their support? Use the sign-up link they gave you.
      </p>
    </form>
  );
}
