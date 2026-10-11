"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { moveTicketAction } from "../tickets/actions";
import { Badge } from "@/app/components/Badge";
import { priorityBadgeClasses } from "@/app/lib/badges";
import { BOARD_COLUMNS, boardTargets, canMove, COLUMN_LABELS } from "@/app/lib/board";
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
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [, startTransition] = useTransition();

  // Fresh server data (after a move or a refresh) replaces local state.
  if (initial !== seenInitial) {
    setSeenInitial(initial);
    setCards(initial);
  }

  function move(card: BoardCard, to: TicketStatus) {
    if (!canMove(card.status, to)) return;
    // Optimistic: show it in the new column straight away.
    setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, status: to, mine: c.mine || c.assigneeId === null } : c)));
    setMessage(null);
    startTransition(async () => {
      const result = await moveTicketAction(card.id, to);
      if (result.ok) {
        setMessage({ text: `Moved ${card.number} to ${COLUMN_LABELS[to]}.`, error: false });
      } else {
        setCards((cs) => cs.map((c) => (c.id === card.id ? card : c)));
        setMessage({ text: result.error, error: true });
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p
        role="status"
        aria-live="polite"
        className={`min-h-5 text-sm ${message?.error ? "text-red-700 dark:text-red-400" : "text-emerald-700 dark:text-emerald-400"}`}
      >
        {message?.text ?? ""}
      </p>
      <div className="grid gap-3 overflow-x-auto pb-2 md:grid-cols-5">
        {BOARD_COLUMNS.map((column) => {
          const inColumn = cards.filter((c) => c.status === column);
          const droppable = dragging !== null && canMove(dragging.status, column);
          return (
            <section
              key={column}
              aria-label={`${COLUMN_LABELS[column]}, ${inColumn.length} tickets`}
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
              className={`flex min-h-48 min-w-56 flex-col gap-2 rounded-xl border p-2 transition-colors ${
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
                  <Link href={`/tickets/${card.id}`} className="line-clamp-2 text-sm font-medium text-black hover:underline dark:text-zinc-50">
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
                  <div className="flex items-center justify-between gap-2 pt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <span>{card.assigneeId === null ? "Unassigned" : card.mine ? "Yours" : "Assigned"}</span>
                    <label className="sr-only" htmlFor={`move-${card.id}`}>
                      Move {card.number} {card.subject}
                    </label>
                    <select
                      id={`move-${card.id}`}
                      value=""
                      onChange={(e) => {
                        if (e.target.value) move(card, e.target.value as TicketStatus);
                      }}
                      className="rounded-md border border-black/[.08] bg-transparent px-1 py-0.5 text-[11px] dark:border-white/[.145]"
                    >
                      <option value="">Move to…</option>
                      {boardTargets(card.status).map((to) => (
                        <option key={to} value={to}>
                          {COLUMN_LABELS[to]}
                        </option>
                      ))}
                    </select>
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
