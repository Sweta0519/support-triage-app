"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { LabelRow, type CardLabel } from "@/app/components/CardBits";
import { LabelPickerPopup, useTicketLabels } from "@/app/components/LabelPicker";
import type { TeamLabel } from "@/app/lib/labels";

// A card's labels, editable in place like Linear (SUP-40): click them, or
// hover the card (or focus something in it) and press L, to open the label
// picker without leaving the queue or the board. With no labels at all, a
// quiet "+ Label" appears on hover or focus. The card element is the
// nearest [data-card] ancestor.
export function CardLabels({
  ticketId,
  ticketLabel,
  labels,
  allLabels,
  appliedIds,
}: {
  ticketId: string;
  ticketLabel: string; // "#1042"
  labels: CardLabel[];
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

  // L on a hovered or focused card, as in Linear. Not while typing.
  useEffect(() => {
    const card = buttonRef.current?.closest<HTMLElement>("[data-card]");
    if (!card) return;
    let hovered = false;
    const enter = () => (hovered = true);
    const leave = () => (hovered = false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "l" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!hovered && !card.contains(document.activeElement)) return;
      e.preventDefault();
      setError(null);
      setOpen(true);
    };
    card.addEventListener("mouseenter", enter);
    card.addEventListener("mouseleave", leave);
    document.addEventListener("keydown", onKey);
    return () => {
      card.removeEventListener("mouseenter", enter);
      card.removeEventListener("mouseleave", leave);
      document.removeEventListener("keydown", onKey);
    };
  }, [setError]);

  const shownText = labels.map((l) => l.text);
  const empty = labels.length === 0;

  return (
    <span className="relative flex min-w-0 flex-col">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-keyshortcuts="L"
        // The name says what it does and what's on the card now; the
        // visible chips stay as they are.
        aria-label={`Edit labels for ${ticketLabel}${shownText.length ? `: ${shownText.join(", ")}` : ""}`}
        title="Edit labels (L)"
        onClick={(e) => {
          e.stopPropagation();
          setError(null);
          setOpen((v) => !v);
        }}
        className={`-mx-1 min-w-0 rounded-md px-1 py-0.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06] ${
          empty && !open
            ? "text-[11px] text-zinc-400 opacity-0 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:text-zinc-500"
            : ""
        }`}
      >
        {empty ? <span aria-hidden>+ Label</span> : <LabelRow labels={labels} />}
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
      {error ? (
        <span role="alert" className="text-[11px] text-red-600 dark:text-red-400">
          {error}
        </span>
      ) : null}
    </span>
  );
}
