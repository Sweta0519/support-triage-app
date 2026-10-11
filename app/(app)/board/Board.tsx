"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { moveTicketAction } from "../tickets/actions";
import { Badge } from "@/app/components/Badge";
import { priorityBadgeClasses } from "@/app/lib/badges";
import { BOARD_COLUMNS, boardTargets, canMove, COLUMN_LABELS, moveClaimsTicket } from "@/app/lib/board";
import type { TicketStatus } from "@/app/lib/ticket-status";

export type BoardCard = {
  id: string;
  number: string;
  subject: string;
  status: TicketStatus;
  assigneeId: string | null;
  mine: boolean;
  priority: string | null;
  sla: { label: string; classes: string } | null;
  escalation: boolean;
  frustrated: boolean;
};

const chip = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium";

export function Board({ cards: initial }: { cards: BoardCard[] }) {
  const router = useRouter();
  const [cards, setCards] = useState(initial);
  const [seenInitial, setSeenInitial] = useState(initial);
  const [dragging, setDragging] = useState<BoardCard | null>(null);
  const [overColumn, setOverColumn] = useState<TicketStatus | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean; seq: number } | null>(null);
  const [pending, setPending] = useState(0);
  const [, startTransition] = useTransition();

  // Fresh server data replaces local state -- but not while a move is
  // still in flight, or an earlier move's refresh could snap a later,
  // not-yet-saved move back.
  if (initial !== seenInitial && pending === 0) {
    setSeenInitial(initial);
    setCards(initial);
  }

  function say(text: string, error: boolean) {
    // seq makes a repeated identical message a new announcement.
    setMessage((m) => ({ text, error, seq: (m?.seq ?? 0) + 1 }));
  }

  function move(card: BoardCard, to: TicketStatus) {
    if (!canMove(card.status, to)) return;
    const claims = moveClaimsTicket(card.assigneeId, to);
    // Optimistic: show it in the new column straight away (and as yours if
    // the move claims it).
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, status: to, ...(claims ? { assigneeId: "me", mine: true } : {}) } : c)));
    setPending((n) => n + 1);
    startTransition(async () => {
      try {
        const result = await moveTicketAction(card.id, to);
        if (result.ok) {
          say(`Moved ${card.number} to ${COLUMN_LABELS[to]}.`, false);
        } else {
          setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, status: card.status, assigneeId: card.assigneeId, mine: card.mine } : c)));
          say(result.error, true);
        }
      } catch {
        setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, status: card.status, assigneeId: card.assigneeId, mine: card.mine } : c)));
        say("That move couldn't be saved. Refreshing the board.", true);
      } finally {
        setPending((n) => n - 1);
        router.refresh();
      }
    });
  }

  return (
    // min-w-0: let the board scroll inside itself instead of widening the page.
    <div className="flex min-w-0 flex-col gap-3">
      <p
        role="status"
        aria-live="polite"
        className={`min-h-5 text-sm ${message?.error ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
      >
        <span key={message?.seq}>{message?.text ?? ""}</span>
      </p>
      {/* Each column track has a minimum width, so narrow screens scroll the
          board sideways instead of squeezing columns on top of each other.
          `relative` makes this the containing block for the cards'
          absolutely positioned sr-only labels, so off-screen columns can't
          stretch the page past the scroll area. */}
      <div className="relative grid gap-3 overflow-x-auto pb-2 md:grid-cols-[repeat(5,minmax(12rem,1fr))]">
        {BOARD_COLUMNS.map((column) => {
          const inColumn = cards.filter((c) => c.status === column);
          const droppable = dragging !== null && canMove(dragging.status, column);
          return (
            <section
              key={column}
              aria-label={`${COLUMN_LABELS[column]}, ${inColumn.length} ticket${inColumn.length === 1 ? "" : "s"}`}
              onDragOver={(e) => {
                if (!droppable) return;
                e.preventDefault();
                setOverColumn(column);
              }}
              onDragLeave={() => setOverColumn((c) => (c === column ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                setOverColumn(null);
                if (dragging && droppable) move(dragging, column);
                setDragging(null);
              }}
              className={`flex min-h-48 min-w-0 flex-col gap-2 rounded-xl border p-2 transition-colors ${
                overColumn === column
                  ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950/30"
                  : droppable
                    ? "border-dashed border-indigo-300 bg-indigo-50/40 dark:border-indigo-800 dark:bg-indigo-950/10"
                    : "border-black/[.08] bg-black/[.015] dark:border-white/[.145] dark:bg-white/[.02]"
              }`}
            >
              <h2 className="flex items-center justify-between px-1 pt-1 text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                {COLUMN_LABELS[column]}
                <span className="rounded-full bg-black/[.05] px-1.5 tabular-nums dark:bg-white/[.08]">{inColumn.length}</span>
              </h2>
              {inColumn.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-zinc-400 dark:text-zinc-500">No tickets</p>
              ) : null}
              {inColumn.map((card) => (
                <article
                  key={card.id}
                  aria-labelledby={`card-${card.id}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", card.id);
                    setDragging(card);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setOverColumn(null);
                  }}
                  className={`flex cursor-grab flex-col gap-1.5 rounded-lg border border-black/[.08] bg-[var(--background)] p-3 shadow-sm active:cursor-grabbing dark:border-white/[.145] ${
                    dragging?.id === card.id ? "opacity-50" : ""
                  }`}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-mono text-zinc-500 dark:text-zinc-400">{card.number}</span>
                    {card.sla ? (
                      <span className="ml-auto">
                        <Badge label={card.sla.label} colorClasses={card.sla.classes} capitalize={false} />
                      </span>
                    ) : null}
                  </div>
                  <Link id={`card-${card.id}`} href={`/tickets/${card.id}`} className="line-clamp-2 text-sm font-medium text-black hover:underline dark:text-zinc-50">
                    {card.subject}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1">
                    {card.priority ? <Badge label={card.priority} colorClasses={priorityBadgeClasses(card.priority)} /> : null}
                    {card.escalation ? (
                      <span className={`${chip} bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300`}>Escalation risk</span>
                    ) : null}
                    {card.frustrated ? (
                      <span className={`${chip} bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300`}>Frustrated</span>
                    ) : null}
                  </div>
                  <p className="pt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                    {card.assigneeId === null ? "Unassigned" : card.mine ? "Yours" : "Assigned"}
                  </p>
                  {/* Its own full-width row: next to the owner it overflowed
                      narrow columns and the Move button was covered. */}
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    {/* Pick, then press Move: a select that moved on change would
                        fire while arrow-keying through a closed select on
                        Windows and in Firefox. */}
                    <form
                      className="flex w-full items-center gap-1"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const to = new FormData(e.currentTarget).get("to");
                        if (typeof to === "string" && to) move(card, to as TicketStatus);
                      }}
                    >
                      <label className="sr-only" htmlFor={`move-${card.id}`}>
                        Move {card.number} {card.subject} to
                      </label>
                      <select
                        id={`move-${card.id}`}
                        name="to"
                        defaultValue=""
                        className="min-w-0 flex-1 rounded-md border border-black/[.08] bg-transparent px-1 py-0.5 text-[11px] dark:border-white/[.145]"
                      >
                        <option value="">Move to…</option>
                        {boardTargets(card.status).map((to) => (
                          <option key={to} value={to}>
                            {COLUMN_LABELS[to]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        aria-label={`Move ${card.number}`}
                        className="shrink-0 rounded-md border border-black/[.08] px-1.5 py-0.5 text-[11px] font-medium hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-white/[.06]"
                      >
                        Move
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
}
