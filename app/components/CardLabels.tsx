"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { cardLabels, LabelRow } from "@/app/components/CardBits";
import { LabelPickerPopup, useTicketLabels } from "@/app/components/LabelPicker";
import type { TeamLabel } from "@/app/lib/labels";

// A card's labels, editable in place like Linear (SUP-40): click them, or
// hover the card (or focus something in it) and press L, to open the label
// picker without leaving the queue or the board. With no labels at all, a
// quiet "+ Label" appears on hover or focus (always on touch screens). The
// card element is the nearest [data-card] ancestor.

// The L shortcut: one document listener for every card on the page. The
// hovered card wins, else the card holding focus -- exactly one, as in
// Linear. Not while typing, and not over an open menu or picker.
const openers = new Map<HTMLElement, () => void>();
let hoveredCard: HTMLElement | null = null;

function onShortcut(e: KeyboardEvent) {
  if (e.key.toLowerCase() !== "l" || e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  if (document.querySelector('[role="menu"], [aria-label="Add or remove labels"]')) return;
  const focusCard = document.activeElement?.closest<HTMLElement>("[data-card]") ?? null;
  const open = openers.get((hoveredCard?.isConnected ? hoveredCard : null) ?? focusCard ?? document.body);
  if (!open) return;
  e.preventDefault();
  open();
}

function registerCard(card: HTMLElement, open: () => void) {
  const enter = () => (hoveredCard = card);
  const leave = () => {
    if (hoveredCard === card) hoveredCard = null;
  };
  if (openers.size === 0) document.addEventListener("keydown", onShortcut);
  openers.set(card, open);
  card.addEventListener("mouseenter", enter);
  card.addEventListener("mouseleave", leave);
  return () => {
    leave();
    openers.delete(card);
    card.removeEventListener("mouseenter", enter);
    card.removeEventListener("mouseleave", leave);
    if (openers.size === 0) document.removeEventListener("keydown", onShortcut);
  };
}

export function CardLabels({
  ticketId,
  ticketLabel,
  signals,
  allLabels,
  appliedIds,
}: {
  ticketId: string;
  ticketLabel: string; // "#1042"
  // The AI's signals for cardLabels(); the team labels come from `applied`.
  signals: Omit<Parameters<typeof cardLabels>[0], "teamLabels">;
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

  useEffect(() => {
    const card = buttonRef.current?.closest<HTMLElement>("[data-card]");
    if (!card) return;
    return registerCard(card, () => {
      setError(null);
      setOpen(true);
    });
  }, [setError]);

  // From the optimistic set, so the chips change as soon as you click.
  // allLabels is sorted by name, like the server's list.
  const labels = cardLabels({ ...signals, teamLabels: allLabels.filter((l) => applied.has(l.id)) });
  // What the chips show: the first two, then "+N".
  const shownText = [...labels.slice(0, 2).map((l) => l.text), ...(labels.length > 2 ? [`+${labels.length - 2}`] : [])];
  const empty = labels.length === 0;

  return (
    <span className="relative flex min-w-0 flex-col">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? popupId : undefined}
        aria-keyshortcuts="L"
        // Starts with what's visible (label-in-name, for voice control),
        // then says what it does.
        aria-label={empty ? `+ Label: add labels for ${ticketLabel}` : `${shownText.join(", ")}: edit labels for ${ticketLabel}`}
        title="Edit labels (L while the card is hovered or focused)"
        onClick={(e) => {
          e.stopPropagation();
          setError(null);
          setOpen((v) => !v);
        }}
        className={`-mx-1 min-w-0 rounded-md px-1 py-0.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06] ${
          empty && !open
            ? "text-[11px] text-zinc-400 opacity-0 [@media(hover:none)]:opacity-100 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:text-zinc-500"
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
