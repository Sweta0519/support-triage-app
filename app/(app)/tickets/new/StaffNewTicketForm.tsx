"use client";


import { staffCreateTicketAction } from "../actions";
import { inputClass, primaryButtonClass } from "@/app/lib/styles";
import { useSafeActionState } from "@/app/components/useSafeActionState";

const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";

// Staff logging a ticket that came in by phone, chat or email. The ticket
// belongs to the customer (it appears in their own list) and is marked as
// filed by this staff member.
export function StaffNewTicketForm() {
  const [state, action, pending, formRef] = useSafeActionState(staffCreateTicketAction, undefined);

  return (
    <form ref={formRef} action={action} className="flex w-full flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="customerEmail" className={labelClass}>
          Customer email
        </label>
        <input
          id="customerEmail"
          name="customerEmail"
          type="email"
          autoComplete="off"
          placeholder="customer@example.com"
          required
          className={inputClass}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Must match an existing customer account. The ticket appears in their own ticket list.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="subject" className={labelClass}>
          Subject
        </label>
        <input id="subject" name="subject" type="text" placeholder="Subject" required className={inputClass} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className={labelClass}>
          Description
        </label>
        <textarea
          id="body"
          name="body"
          placeholder="What did the customer report? Include what they told you, in their words where possible."
          required
          rows={6}
          className={inputClass}
        />
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          The AI triage reads this like any other ticket.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" name="assignToMe" defaultChecked className="h-4 w-4 accent-indigo-600" />
        Assign to me
      </label>
      {state?.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className={`self-start ${primaryButtonClass}`}>
        {pending ? "Creating…" : "Create ticket"}
      </button>
    </form>
  );
}
