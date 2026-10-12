"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { createAndApplyLabelAction, setTicketLabelAction } from "@/app/(app)/labels/actions";
import { labelDot, type TeamLabel } from "@/app/lib/labels";

// The Linear-style label picker (SUP-39/SUP-40), shared by the ticket
// page's Labels section and the labels on queue and board cards: search
// the team's labels, click to add or remove, or create one from what you
// typed. Server Actions (CSRF); RLS is the real enforcement.

// A ticket's applied labels, kept optimistically and replaced by server
// data after each refresh.
export function useTicketLabels(ticketId: string, appliedIds: string[]) {
  const router = useRouter();
  const [applied, setApplied] = useState<Set<string>>(new Set(appliedIds));
  const [shownProps, setShownProps] = useState(appliedIds);
  // Server data wins after a refresh (adjusting state during render).
  if (shownProps !== appliedIds) {
    setShownProps(appliedIds);
    setApplied(new Set(appliedIds));
  }
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // A ref as well as state: a second click or Enter arrives before the
  // re-render, and must not start a second request.
  const busy = useRef(false);

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
    setError(result && !result.ok ? result.error : null);
    router.refresh();
  }

  // true when the label was created and applied.
  async function create(name: string): Promise<boolean> {
    const result = await run(() => createAndApplyLabelAction(ticketId, name));
    if (!result) return false;
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setError(null);
    if (result.label) setApplied((prev) => new Set(prev).add(result.label!.id));
    router.refresh();
    return true;
  }

  return { applied, pending, error, setError, toggle, create };
}

// The popup. `anchor` is the button that opened it: the popup is placed
// under it with position:fixed, so a card's overflow:hidden can't clip it.
// Escape (focus back to the anchor), a click outside, or tabbing out
// closes it; it follows the anchor on scroll.
export function LabelPickerPopup({
  id,
  anchor,
  allLabels,
  applied,
  pending,
  onToggle,
  onCreate,
  onClose,
}: {
  id: string;
  anchor: React.RefObject<HTMLElement | null>;
  allLabels: TeamLabel[];
  applied: Set<string>;
  pending: boolean;
  onToggle: (label: TeamLabel) => void;
  onCreate: (name: string) => Promise<boolean>;
  onClose: (restoreFocus: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Under the anchor, flipped above it when there's no room below; placed
  // again on scroll and resize so it stays with its card.
  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const box = boxRef.current?.getBoundingClientRect();
      if (!a || !box) return;
      const below = a.bottom + 4;
      const top = below + box.height + 8 <= window.innerHeight ? below : Math.max(8, a.top - box.height - 4);
      setPosition({ left: Math.max(8, Math.min(a.left, window.innerWidth - box.width - 8)), top });
    };
    const onScroll = (e: Event) => {
      if (!boxRef.current?.contains(e.target as Node)) place();
    };
    place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor]);

  // Focus the search once it's placed (hidden elements can't take focus),
  // not again each time scrolling moves it.
  const focused = useRef(false);
  useEffect(() => {
    if (!position || focused.current) return;
    focused.current = true;
    inputRef.current?.focus();
  }, [position]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!boxRef.current?.contains(t) && !anchor.current?.contains(t)) onClose(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(true);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [anchor, onClose]);

  const q = query.trim().toLowerCase();
  const matches = allLabels.filter((l) => l.name.toLowerCase().includes(q));
  const exact = allLabels.some((l) => l.name.toLowerCase() === q);

  async function create() {
    if (await onCreate(query)) setQuery("");
  }

  return (
    <div
      ref={boxRef}
      id={id}
      role="group"
      aria-label="Add or remove labels"
      style={position ?? { left: 0, top: 0, visibility: "hidden" }}
      className="fixed z-50 flex w-64 cursor-default flex-col gap-1 rounded-lg border border-black/[.08] bg-white p-1.5 shadow-lg dark:border-white/[.145] dark:bg-zinc-900"
      // Inside a card: keep its keys (Shift+F10, the Menu key) and clicks
      // from reaching the card's own handlers.
      onKeyDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && !boxRef.current?.contains(next) && !anchor.current?.contains(next)) onClose(false);
      }}
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
              onClick={() => onToggle(label)}
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
  );
}
