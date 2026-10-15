"use client";

import { useActionState } from "react";
import Link from "next/link";

import { signUpAction } from "@/app/lib/auth/actions";
import { ACCESS_PURPOSE_MAX, ACCESS_TEAM_MAX, TEAM_SIZES } from "@/app/lib/access-request-options";
import { inputClass, linkClass, primaryButtonClass } from "@/app/lib/styles";

const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

export function SignupForm({ requestingAccess = false }: { requestingAccess?: boolean }) {
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
      {requestingAccess ? (
        <fieldset className="flex flex-col gap-3 border-t border-black/[.08] pt-4 dark:border-white/[.145]">
          <legend className="sr-only">About your team (optional)</legend>
          <input type="hidden" name="access" value="1" />
          <p aria-hidden="true" className="text-sm font-medium text-black dark:text-zinc-50">
            About your team <span className="font-normal text-zinc-500">(optional)</span>
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="team" className={labelClass}>
              Team or company name
            </label>
            <input id="team" name="team" maxLength={ACCESS_TEAM_MAX} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="size" className={labelClass}>
              Team size
            </label>
            <select id="size" name="size" defaultValue="" className={inputClass}>
              <option value="">Choose…</option>
              {TEAM_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} people
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="purpose" className={labelClass}>
              What would you use it for?
            </label>
            <textarea id="purpose" name="purpose" rows={3} maxLength={ACCESS_PURPOSE_MAX} className={inputClass} />
          </div>
        </fieldset>
      ) : null}
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button type="submit" disabled={pending} className={`${primaryButtonClass} w-full`}>
        {requestingAccess ? "Request access" : "Sign up"}
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
