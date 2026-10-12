"use client";

import { useFormStatus } from "react-dom";

import { claimFromQueueAction } from "../tickets/actions";
import type { QueueFilterKey } from "@/app/lib/queue-filters";
import { primaryButtonClass } from "@/app/lib/styles";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      className={`${primaryButtonClass} !px-3 !py-1 !text-xs disabled:opacity-60`}
    >
      {pending ? "Claiming…" : "Claim"}
    </button>
  );
}

// Claim on a queue card. Shows progress while the claim runs; the action
// then redirects -- to the ticket on success, back to this queue view with
// a notice if someone else got there first.
export function ClaimButton({
  ticketId,
  label,
  from,
  returnTo,
}: {
  ticketId: string;
  // Accessible name, e.g. "Claim #1042: Invoice is wrong".
  label: string;
  from: QueueFilterKey;
  returnTo: string;
}) {
  return (
    <form action={claimFromQueueAction} className="flex items-center">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <SubmitButton label={label} />
    </form>
  );
}
