// First-response SLA, derived from data the tickets table already has: the
// clock runs from created_at until first_response_at (stamped by the first
// public staff comment). Wall-clock time, nights and weekends included.
// Plain data, no "server-only" -- client components may format it too.

import type { TicketStatus } from "@/app/lib/db/tickets";

const HOUR_MS = 60 * 60 * 1000;

export const SLA_TARGET_MS = {
  urgent: 1 * HOUR_MS,
  high: 4 * HOUR_MS,
  normal: 8 * HOUR_MS,
  low: 24 * HOUR_MS,
} as const;

type SlaPriority = keyof typeof SLA_TARGET_MS;

// A ticket the AI hasn't prioritised yet (or couldn't) is held to the
// normal target rather than given no deadline at all.
const DEFAULT_PRIORITY: SlaPriority = "normal";

// "At risk" once a quarter or less of the window is left.
const AT_RISK_FRACTION = 0.25;

export type SlaState = "on_track" | "at_risk" | "breached" | "met" | "missed";

export type Sla = {
  state: SlaState;
  priority: SlaPriority;
  targetMs: number;
  dueAt: Date;
  // Waiting: time left until dueAt (negative once breached).
  // Answered: how long the first response took.
  remainingMs: number | null;
  responseMs: number | null;
};

function slaPriority(priority: string | null): SlaPriority {
  return priority !== null && priority in SLA_TARGET_MS ? (priority as SlaPriority) : DEFAULT_PRIORITY;
}

// The target follows the ticket's *current* priority, so raising it (by the
// AI or a reviewer) can move the deadline earlier, even into the past.
// Returns null for a resolved or closed ticket that never got a public
// reply: the clock has stopped and there is no response to measure.
export function computeSla(
  ticket: {
    created_at: string;
    first_response_at: string | null;
    status: TicketStatus;
    priority: string | null;
  },
  now: Date = new Date()
): Sla | null {
  const priority = slaPriority(ticket.priority);
  const targetMs = SLA_TARGET_MS[priority];
  const createdMs = new Date(ticket.created_at).getTime();
  const dueAt = new Date(createdMs + targetMs);

  if (ticket.first_response_at !== null) {
    const responseMs = new Date(ticket.first_response_at).getTime() - createdMs;
    return {
      state: responseMs <= targetMs ? "met" : "missed",
      priority,
      targetMs,
      dueAt,
      remainingMs: null,
      responseMs,
    };
  }

  if (ticket.status === "resolved" || ticket.status === "closed") {
    return null;
  }

  const remainingMs = dueAt.getTime() - now.getTime();
  const state: SlaState =
    remainingMs < 0 ? "breached" : remainingMs <= targetMs * AT_RISK_FRACTION ? "at_risk" : "on_track";
  return { state, priority, targetMs, dueAt, remainingMs, responseMs: null };
}

// "45m", "3h 20m", "2d 4h" -- compact enough for a queue badge.
export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

// Short text for a badge: what an agent needs to know at a glance.
export function slaBadgeLabel(sla: Sla): string {
  switch (sla.state) {
    case "on_track":
    case "at_risk":
      return `Reply in ${formatDuration(sla.remainingMs ?? 0)}`;
    case "breached":
      return `Overdue ${formatDuration(sla.remainingMs ?? 0)}`;
    case "met":
      return "Replied in time";
    case "missed":
      return "Replied late";
  }
}

// The longer sentence for the ticket view.
export function slaDescription(sla: Sla): string {
  const target = `${formatDuration(sla.targetMs)} target for ${sla.priority} priority`;
  switch (sla.state) {
    case "on_track":
    case "at_risk":
      return `First reply due in ${formatDuration(sla.remainingMs ?? 0)} (${target}).`;
    case "breached":
      return `First reply overdue by ${formatDuration(sla.remainingMs ?? 0)} (${target}).`;
    case "met":
      return `First reply sent after ${formatDuration(sla.responseMs ?? 0)}, within the ${target}.`;
    case "missed":
      return `First reply sent after ${formatDuration(sla.responseMs ?? 0)}, past the ${target}.`;
  }
}

export function slaBadgeClasses(state: SlaState): string {
  switch (state) {
    case "on_track":
      return "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
    case "at_risk":
      return "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300";
    case "breached":
      return "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300";
    case "met":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
    case "missed":
      return "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300";
  }
}
