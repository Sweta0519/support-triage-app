"use client";

import { useActionState, useEffect, useRef } from "react";

import { sendMessageAction } from "./actions";
import { inputClass, primaryButtonClass } from "@/app/lib/styles";

export function ChatForm() {
  const [state, action, pending] = useActionState(sendMessageAction, undefined);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the textarea only after a successful send -- if the action
  // returned an error, the draft stays so the agent doesn't lose it.
  useEffect(() => {
    if (!pending && !state?.error) {
      formRef.current?.reset();
    }
  }, [pending, state]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <textarea
        name="content"
        placeholder="Ask the assistant..."
        required
        rows={3}
        className={inputClass}
      />
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className={`self-start ${primaryButtonClass} !px-4 !py-1.5 !text-xs`}
      >
        {pending ? "Thinking..." : "Send"}
      </button>
    </form>
  );
}
