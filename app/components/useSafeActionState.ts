"use client";

import { useActionState, useCallback, useLayoutEffect, useRef } from "react";
import { unstable_rethrow } from "next/navigation";

// useActionState for forms whose Server Action can fail before it runs: the
// Vercel firewall's 429 (docs/security/vercel-waf.md), or a dropped
// connection. Without this, the rejected action reaches no error boundary
// the form can recover from, the page is replaced by "This page couldn't
// load", and whatever was typed is lost (SUP-75).
//
// Here a failure becomes the form's own error state (FAILED_MESSAGE), and
// the fields are put back as they were sent: React clears a form after its
// action, failed or not. Put `formRef` on the <form>.
export const FAILED_MESSAGE =
  "That didn't go through: too many requests, or the connection dropped. Nothing was saved. Wait a moment and try again.";

export function useSafeActionState<S>(
  action: (state: Awaited<S>, formData: FormData) => S | Promise<S>,
  initial: Awaited<S>,
  // The form's error state, for forms whose state isn't { error }.
  failed: (message: string, sent: FormData) => Awaited<S> = (message) => ({ error: message }) as Awaited<S>
) {
  const sent = useRef<FormData | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const safe = useCallback(
    async (state: Awaited<S>, formData: FormData): Promise<Awaited<S>> => {
      try {
        const result = await action(state, formData);
        sent.current = null;
        return result;
      } catch (error) {
        // redirect() and notFound() are thrown on purpose: let Next.js handle them.
        unstable_rethrow(error);
        sent.current = formData;
        return failed(FAILED_MESSAGE, formData);
      }
    },
    [action, failed]
  );
  const [state, formAction, pending] = useActionState(safe, initial);

  // After a failure, once React has reset the form, refill what was typed.
  useLayoutEffect(() => {
    const form = formRef.current;
    const data = sent.current;
    if (!form || !data || pending) return;
    sent.current = null;
    for (const element of Array.from(form.elements)) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) continue;
      if (!element.name || (element instanceof HTMLInputElement && ["file", "hidden", "password", "submit"].includes(element.type))) continue;
      const values = data.getAll(element.name).map(String);
      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        element.checked = values.includes(element.value);
      } else if (values.length) {
        element.value = values[0];
      }
    }
  }, [state, pending]);

  return [state, formAction, pending, formRef] as const;
}

// The same for an action called from a click handler, which no form or
// error boundary sees: a rejected call reads as the action's own refusal.
export async function orFailed<T>(call: Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await call;
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: FAILED_MESSAGE };
  }
}
