"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signUpAction } from "@/app/lib/auth/actions";

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpAction, undefined);

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-4">
      <input
        name="email"
        type="email"
        placeholder="Email"
        required
        className="rounded-lg border border-black/[.08] bg-white px-4 py-2 text-black outline-none focus:border-black/30 dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus:border-white/30"
      />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        minLength={8}
        className="rounded-lg border border-black/[.08] bg-white px-4 py-2 text-black outline-none focus:border-black/30 dark:border-white/[.145] dark:bg-black dark:text-zinc-50 dark:focus:border-white/30"
      />
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Password must be at least 8 characters.
      </p>
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-foreground px-5 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-50 dark:hover:bg-[#ccc]"
      >
        Sign up
      </button>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className="underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
