"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { queueCardAction, type CardActionInput } from "./actions";
import { useAnnounce } from "./QueueAnnouncer";
import { COLUMN_LABELS } from "@/app/lib/board";
import { ALLOWED_STATUS_TRANSITIONS, type TicketStatus } from "@/app/lib/ticket-status";
import { fieldLabel, TRIAGE_CATEGORIES, TRIAGE_PRIORITIES, TRIAGE_TEAMS } from "@/app/lib/triage-fields";

// The queue card's quick-action menu (SUP-27). Opens on right-click (the
// browser's own menu still appears with Shift held or text selected), from
// the "⋯" button, or with Shift+F10 / the Menu key on the card. A real
// menu: role="menu", arrow keys, Home/End, Escape (back, then close), and
// focus returns to whatever opened it. Items appear only when the role
// and the ticket's state allow them; the server checks again.

export type CardMenuTicket = {
  id: string;
  label: string; // "#1042"
  href: string;
  status: TicketStatus;
  assigneeId: string | null;
  flagged: boolean;
  triage: { priority: string; category: string; team: string } | null;
  // The AI run and review the card was rendered with (see queueCardAction).
  triageResultId: string | null;
  triageReviewedAt: string | null;
};

type Item =
  | { kind: "action"; label: string; input: CardActionInput; checked?: boolean }
  | { kind: "panel"; label: string; panel: Panel }
  | { kind: "local"; label: string; run: () => void | Promise<void> }
  | { kind: "back" };

type Panel = "main" | "assign" | "priority" | "category" | "team";

const itemClass =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-zinc-700 outline-none hover:bg-indigo-50 focus:bg-indigo-50 aria-disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-indigo-950/40 dark:focus:bg-indigo-950/40";

export function CardMenuArea({
  ticket,
  currentUserId,
  isAdmin,
  staff,
  footer,
  children,
}: {
  ticket: CardMenuTicket;
  currentUserId: string;
  isAdmin: boolean;
  // Admins only: who a ticket can be assigned to.
  staff: { id: string; label: string }[];
  // The card's own footer content (e.g. the Claim button), next to "⋯".
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const announce = useAnnounce();
  const areaRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // After "← Back", focus the item that opened the panel.
  const focusPanelItem = useRef<Panel | null>(null);
  // above: the top of what opened it (the ⋯ button), to flip the menu
  // above it when there's no room below rather than covering it.
  const [open, setOpen] = useState<{ x: number; y: number; above?: number } | null>(null);
  const [panel, setPanel] = useState<Panel>("main");
  const [pending, setPending] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  // Built only while open: some items read window (the link to copy).
  const items = open ? menuItems(panel, ticket, currentUserId, isAdmin, staff, announce) : [];

  function openAt(x: number, y: number, from: HTMLElement | null, above?: number) {
    returnFocus.current = from;
    setPanel("main");
    setPosition(null);
    setOpen({ x, y, above });
  }

  function close(restoreFocus = true) {
    setOpen(null);
    setPanel("main");
    if (restoreFocus) returnFocus.current?.focus();
  }

  // Keep the menu inside the viewport, then focus its first item.
  useLayoutEffect(() => {
    if (!open || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const fitsBelow = open.y + rect.height + 8 <= window.innerHeight;
    const top = fitsBelow || open.above === undefined ? open.y : open.above - rect.height - 4;
    setPosition({
      left: Math.max(8, Math.min(open.x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - rect.height - 8)),
    });
  }, [open, panel]);

  // Focus the first item once placed: while it's still being measured the
  // menu is visibility:hidden, and hidden elements can't take focus.
  useEffect(() => {
    if (!open || !position) return;
    const back = focusPanelItem.current;
    focusPanelItem.current = null;
    const target = back ? menuRef.current?.querySelector<HTMLElement>(`[data-panel="${back}"]`) : null;
    (target ?? menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
  }, [open, panel, position]);

  // A click anywhere else closes it. Not the "⋯" button: its own click
  // toggles the menu, and closing here first would just reopen it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        setOpen(null);
        setPanel("main");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function run(item: Item) {
    if (pending) return;
    if (item.kind === "back") {
      focusPanelItem.current = panel;
      setPanel("main");
      return;
    }
    if (item.kind === "panel") {
      setPanel(item.panel);
      return;
    }
    if (item.kind === "local") {
      close();
      await item.run();
      return;
    }
    setPending(true);
    try {
      const result = await queueCardAction(ticket.id, item.input);
      announce(result.ok ? result.message : result.error, result.ok ? "ok" : "error");
    } catch {
      announce("That didn't work. Please try again.", "error");
    } finally {
      setPending(false);
      close();
      router.refresh();
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    // The menu sits inside the card: keep its keys (Shift+F10, the Menu
    // key) from reaching the card's handler and reopening it.
    e.stopPropagation();
    const nodes = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => nodes[(i + nodes.length) % nodes.length]?.focus();
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        focus(index + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        focus(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focus(0);
        break;
      case "End":
        e.preventDefault();
        focus(nodes.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        if (panel !== "main") {
          focusPanelItem.current = panel;
          setPanel("main");
        } else close();
        break;
      case "Tab":
        e.preventDefault();
        close();
        break;
    }
  }

  return (
    <li
      ref={areaRef}
      className="flex flex-col overflow-hidden rounded-xl border border-black/[.08] transition-colors hover:border-indigo-300 dark:border-white/[.145] dark:hover:border-indigo-800"
      onContextMenu={(e) => {
        // Leave the browser's menu alone when the user is after it: Shift
        // held, or text selected (to copy it).
        if (e.shiftKey || (window.getSelection()?.toString() ?? "") !== "") return;
        e.preventDefault();
        openAt(e.clientX, e.clientY, areaRef.current?.querySelector("a") ?? buttonRef.current);
      }}
      onKeyDown={(e) => {
        if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
          e.preventDefault();
          const target = e.target as HTMLElement;
          const rect = target.getBoundingClientRect();
          openAt(rect.left + 16, rect.top + 16, target);
        }
      }}
    >
      {children}
      <div className="flex items-center justify-between gap-2 border-t border-black/[.08] px-4 py-2 dark:border-white/[.145]">
        <button
          ref={buttonRef}
          type="button"
          aria-haspopup="menu"
          aria-expanded={open !== null}
          aria-label={`Actions for ${ticket.label}`}
          onClick={(e) => {
            if (open) {
              close();
              return;
            }
            const rect = e.currentTarget.getBoundingClientRect();
            openAt(rect.left, rect.bottom + 4, e.currentTarget, rect.top);
          }}
          className="rounded-md px-2 py-0.5 text-base leading-none text-zinc-500 hover:bg-black/[.05] hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[.08] dark:hover:text-zinc-100"
        >
          ⋯
        </button>
        {footer}
      </div>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${ticket.label}`}
          onKeyDown={onMenuKeyDown}
          // A right-click on the menu itself mustn't reach the card's handler.
          onContextMenu={(e) => e.stopPropagation()}
          style={{ position: "fixed", left: position?.left ?? open.x, top: position?.top ?? open.y, visibility: position ? "visible" : "hidden" }}
          aria-busy={pending || undefined}
          className="z-50 flex min-w-52 flex-col gap-0.5 rounded-lg border border-black/[.08] bg-white p-1 shadow-lg dark:border-white/[.145] dark:bg-zinc-900"
        >
          {items.map((item, i) =>
            item === null ? (
              <div key={`sep-${i}`} role="separator" className="my-0.5 border-t border-black/[.06] dark:border-white/[.08]" />
            ) : (
              <button
                key={`${panel}-${i}`}
                type="button"
                role={item.kind === "action" && item.checked !== undefined ? "menuitemradio" : "menuitem"}
                aria-checked={item.kind === "action" && item.checked !== undefined ? item.checked : undefined}
                aria-haspopup={item.kind === "panel" ? "menu" : undefined}
                data-panel={item.kind === "panel" ? item.panel : undefined}
                tabIndex={-1}
                // aria-disabled, not disabled: a disabled button drops focus,
                // and the menu's keys would stop working while it runs.
                aria-disabled={pending || undefined}
                onClick={() => run(item)}
                className={itemClass}
              >
                {item.kind === "back" ? "← Back" : item.label}
                {item.kind === "panel" ? <span aria-hidden className="ml-auto text-zinc-400">›</span> : null}
                {item.kind === "action" && item.checked ? <span aria-hidden className="ml-auto">✓</span> : null}
              </button>
            )
          )}
        </div>
      ) : null}
    </li>
  );
}

// null = a separator.
function menuItems(
  panel: Panel,
  ticket: CardMenuTicket,
  currentUserId: string,
  isAdmin: boolean,
  staff: { id: string; label: string }[],
  announce: (text: string, tone: "ok" | "error") => void
): (Item | null)[] {
  const triage = ticket.triage;
  if (panel === "assign") {
    return [
      { kind: "back" },
      ...staff.map((s) => ({
        kind: "action" as const,
        label: s.id === currentUserId ? `${s.label} (you)` : s.label,
        input: { kind: "assign" as const, assigneeId: s.id },
        checked: ticket.assigneeId === s.id,
      })),
    ];
  }
  if (panel === "priority" || panel === "category" || panel === "team") {
    const values = panel === "priority" ? TRIAGE_PRIORITIES : panel === "category" ? TRIAGE_CATEGORIES : TRIAGE_TEAMS;
    return [
      { kind: "back" },
      ...values.map((value) => ({
        kind: "action" as const,
        label: fieldLabel(value),
        input: {
          kind: "triage" as const,
          field: panel,
          value,
          shown: triage!,
          resultId: ticket.triageResultId,
          reviewedAt: ticket.triageReviewedAt,
        },
        checked: triage?.[panel] === value,
      })),
    ];
  }

  const copy = (text: string, what: string) => async () => {
    try {
      await navigator.clipboard.writeText(text);
      announce(`Copied ${what}.`, "ok");
    } catch {
      announce(`Couldn't copy the ${what}.`, "error");
    }
  };
  const link = `${window.location.origin}${ticket.href}`;

  const items: (Item | null)[] = [];
  const canClaim = ticket.assigneeId === null && ticket.status !== "resolved" && ticket.status !== "closed";
  if (canClaim) {
    items.push({ kind: "action", label: "Claim", input: { kind: "claim" } });
  }
  for (const to of ALLOWED_STATUS_TRANSITIONS[ticket.status]) {
    // Moving an unassigned ticket to Assigned is exactly a claim.
    if (canClaim && to === "assigned") continue;
    items.push({ kind: "action", label: `Move to ${COLUMN_LABELS[to]}`, input: { kind: "status", to } });
  }
  if (isAdmin) {
    items.push({ kind: "panel", label: "Assign to…", panel: "assign" });
    if (ticket.assigneeId !== null) {
      items.push({ kind: "action", label: "Unassign", input: { kind: "assign", assigneeId: null } });
    }
  }
  if (triage) {
    items.push(
      null,
      { kind: "panel", label: "Set priority…", panel: "priority" },
      { kind: "panel", label: "Set category…", panel: "category" },
      { kind: "panel", label: "Set team…", panel: "team" }
    );
  }
  items.push(
    null,
    ticket.flagged
      ? { kind: "action", label: "Remove flag", input: { kind: "flag", flagged: false } }
      : { kind: "action", label: "Flag to follow up", input: { kind: "flag", flagged: true } },
    { kind: "action", label: "Re-run AI triage", input: { kind: "rerun" } },
    null,
    { kind: "local", label: "Open in new tab", run: () => void window.open(ticket.href, "_blank", "noopener") },
    { kind: "local", label: "Copy ticket number", run: copy(ticket.label, "ticket number") },
    { kind: "local", label: "Copy link", run: copy(link, "link") }
  );
  return items;
}
