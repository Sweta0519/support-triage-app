"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { aiSignals, AiSignal, LabelRow } from "@/app/components/CardBits";
import { LabelPickerPopup, useTicketLabels } from "@/app/components/LabelPicker";
import { labelDot, type TeamLabel } from "@/app/lib/labels";

// A card's labels, editable in place like Linear (SUP-40): click them, or
// hover the card (or focus something in it) and press L, to open the label
// picker without leaving the queue or the board. With no labels at all, a
// quiet "+ Label" appears on hover or focus (always on touch screens). The
// AI's read sits beside the labels, outside the button, and is read-only
// (SUP-41). The card element is the nearest [data-card] ancestor.

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
  // The AI's signals, shown beside the labels but read-only (SUP-41).
  signals: Parameters<typeof aiSignals>[0];
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

  // Team labels only, from the optimistic set, so the pills change as soon
  // as you click. allLabels is sorted by name, like the server's list.
  const labels = allLabels.filter((l) => applied.has(l.id)).map((l) => ({ text: l.name, dot: labelDot(l.color) }));
  // What the pills show: the first two, then "+N".
  const shownText = [...labels.slice(0, 2).map((l) => l.text), ...(labels.length > 2 ? [`+${labels.length - 2}`] : [])];
  const empty = labels.length === 0;
  const ai = aiSignals(signals);

  const button = (
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
      // One button in one place (no remount when the first label is added
      // or the last removed); with no labels CSS moves it after the AI's
      // read, so the hover-only "+ Label" leaves no gap at the start.
      className={`-mx-1 min-w-0 rounded-md px-1 py-0.5 text-left hover:bg-black/[.04] dark:hover:bg-white/[.06] ${empty ? "order-last" : ""} ${
        empty && !open
          ? "text-[11px] text-zinc-400 opacity-0 [@media(hover:none)]:opacity-100 focus:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:text-zinc-500"
          : ""
      }`}
    >
      {empty ? <span aria-hidden>+ Label</span> : <LabelRow labels={labels} />}
    </button>
  );

  return (
    <span className="relative flex min-w-0 flex-col">
      {/* Team labels (pills, clickable) and the AI's read (✦ text, not
          clickable) on one row. With no labels, the AI's read comes first
          and the hover-only "+ Label" after it, so nothing leaves a gap. */}
      <span className="flex min-w-0 items-center gap-2">
        {button}
        <AiSignal signals={ai} />
      </span>
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
