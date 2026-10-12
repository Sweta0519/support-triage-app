"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState } from "react";

import { LabelPickerPopup, useTicketLabels } from "@/app/components/LabelPicker";
import { labelDot, type TeamLabel } from "@/app/lib/labels";

// The ticket's team labels (SUP-39), Linear-style: chips you can remove,
// and an "Add label" picker that searches the team's labels, toggles them,
// and creates a new one from what you typed. Staff only (the page renders
// it for staff; RLS enforces it).
export function LabelsPanel({
  ticketId,
  allLabels,
  appliedIds,
}: {
  ticketId: string;
  allLabels: TeamLabel[];
  appliedIds: string[];
}) {
  const { applied, pending, error, setError, toggle, create } = useTicketLabels(ticketId, appliedIds);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  const appliedLabels = allLabels.filter((l) => applied.has(l.id));

  return (
    <section aria-labelledby="labels-heading" className="flex flex-col gap-2 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <div className="flex items-center justify-between">
        <h2 id="labels-heading" className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
          Labels
        </h2>
        <Link href="/labels" className="text-xs text-zinc-500 hover:underline dark:text-zinc-400">
          Manage
        </Link>
      </div>

      <ul className="flex flex-wrap gap-1.5">
        {appliedLabels.map((label) => (
          <li
            key={label.id}
            className="inline-flex items-center gap-1 rounded-full border border-black/[.1] py-0.5 pl-2 pr-1 text-xs text-zinc-700 dark:border-white/[.15] dark:text-zinc-200"
          >
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${labelDot(label.color)}`} />
            {label.name}
            <button
              type="button"
              onClick={() => toggle(label)}
              aria-label={`Remove label ${label.name}`}
              className="rounded-full px-1 text-zinc-400 hover:bg-black/[.06] hover:text-zinc-700 dark:hover:bg-white/[.08] dark:hover:text-zinc-100"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div>
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          onClick={() => {
            setError(null);
            setOpen((v) => !v);
          }}
          className="text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          + Add label
        </button>
        {open ? (
          <LabelPickerPopup
            id={popupId}
            anchor={buttonRef}
            allLabels={allLabels}
            applied={applied}
            pending={pending}
            onToggle={toggle}
            onCreate={create}
            onClose={close}
          />
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
