"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signUpAction } from "@/app/lib/auth/actions";
import { inputClass, linkClass, primaryButtonClass } from "@/app/lib/styles";

export function SignupForm() {
  const [state, action, pending] = useActionState(signUpAction, undefined);

  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <input name="email" type="email" placeholder="Email" required className={inputClass} />
      <input
        name="password"
        type="password"
        placeholder="Password"
        required
        minLength={8}
        className={inputClass}
      />
      <p className="-mt-2 text-xs text-zinc-500 dark:text-zinc-500">
        At least 8 characters.
      </p>
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
        Sign up
      </button>
      <p className="text-center text-xs text-zinc-500 dark:text-zinc-500">
        We use your email only to run your account. See how your data is handled in the{" "}
        <Link href="/privacy" className={linkClass}>
          privacy policy
        </Link>
        .
      </p>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
      </p>
    </form>
  );
}
