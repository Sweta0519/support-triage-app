"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import { createAndApplyLabelAction, setTicketLabelAction } from "../../labels/actions";
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
  const router = useRouter();
  const [applied, setApplied] = useState<Set<string>>(new Set(appliedIds));
  const [shownProps, setShownProps] = useState(appliedIds);
  // Server data wins after a refresh (adjusting state during render).
  if (shownProps !== appliedIds) {
    setShownProps(appliedIds);
    setApplied(new Set(appliedIds));
  }
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // A ref as well as state: a second click or Enter arrives before the
  // re-render, and must not start a second request.
  const busy = useRef(false);
  const popupId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const appliedLabels = allLabels.filter((l) => applied.has(l.id));
  const q = query.trim().toLowerCase();
  const matches = allLabels.filter((l) => l.name.toLowerCase().includes(q));
  const exact = allLabels.some((l) => l.name.toLowerCase() === q);

  async function run<T>(work: () => Promise<T>): Promise<T | undefined> {
    if (busy.current) return undefined;
    busy.current = true;
    setPending(true);
    try {
      return await work();
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function toggle(label: TeamLabel) {
    if (busy.current) return;
    const on = !applied.has(label.id);
    setApplied((prev) => {
      const next = new Set(prev);
      if (on) next.add(label.id);
      else next.delete(label.id);
      return next;
    });
    const result = await run(() => setTicketLabelAction(ticketId, label.id, on));
    if (result && !result.ok) setError(result.error);
    router.refresh();
  }

  async function create() {
    const result = await run(() => createAndApplyLabelAction(ticketId, query));
    if (!result) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setQuery("");
    if (result.label) setApplied((prev) => new Set(prev).add(result.label!.id));
    router.refresh();
  }

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
              aria-disabled={pending}
              aria-label={`Remove label ${label.name}`}
              className="rounded-full px-1 text-zinc-400 hover:bg-black/[.06] hover:text-zinc-700 dark:hover:bg-white/[.08] dark:hover:text-zinc-100"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div
        ref={boxRef}
        className="relative"
        onBlur={(e) => {
          // Tabbing out of the picker closes it, like clicking outside.
          if (open && !boxRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
      >
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
          <div
            id={popupId}
            role="group"
            aria-label="Add or remove labels"
            className="absolute left-0 top-6 z-30 flex w-64 flex-col gap-1 rounded-lg border border-black/[.08] bg-white p-1.5 shadow-lg dark:border-white/[.145] dark:bg-zinc-900"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && q && !exact) {
                  e.preventDefault();
                  void create();
                }
              }}
              placeholder="Search or create a label…"
              aria-label="Search or create a label"
              className="rounded-md border border-black/[.08] bg-transparent px-2 py-1 text-xs outline-none focus:border-indigo-400 dark:border-white/[.145]"
            />
            <ul aria-label="Team labels" className="max-h-56 overflow-y-auto">
              {matches.map((label) => (
                <li key={label.id}>
                  <button
                    type="button"
                    aria-pressed={applied.has(label.id)}
                    onClick={() => toggle(label)}
                    aria-disabled={pending}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-zinc-700 hover:bg-black/[.04] dark:text-zinc-200 dark:hover:bg-white/[.06]"
                  >
                    <span aria-hidden className={`h-2 w-2 rounded-full ${labelDot(label.color)}`} />
                    <span className="flex-1">{label.name}</span>
                    {applied.has(label.id) ? <span aria-hidden>✓</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {q && !exact ? (
              <button
                type="button"
                onClick={() => void create()}
                aria-disabled={pending}
                className="rounded-md px-2 py-1 text-left text-xs text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
              >
                Create “{query.trim()}”
              </button>
            ) : null}
            {matches.length === 0 && !q ? (
              <p className="px-2 py-1 text-xs text-zinc-500">No labels yet -- type a name to create one.</p>
            ) : null}
          </div>
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
