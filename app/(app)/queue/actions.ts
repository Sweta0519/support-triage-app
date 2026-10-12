"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/app/lib/auth/session";
import { assignTicket, claimTicket, getTicketForStaff, isUuid, type TicketStatus } from "@/app/lib/db/tickets";
import { listStaffProfiles } from "@/app/lib/db/profiles";
import { setFlag } from "@/app/lib/db/flags";
import { checkRateLimit, RATE_LIMITED_MESSAGE, RateLimitError } from "@/app/lib/db/rate-limit";
import { getLatestTriageResult, reviewTriage, TriageReviewError } from "@/app/lib/db/triage";
import { rerunTriage } from "@/app/lib/ai/triage";
import { moveTicketAs } from "@/app/lib/ticket-moves";
import { ALLOWED_STATUS_TRANSITIONS } from "@/app/lib/ticket-status";
import { COLUMN_LABELS } from "@/app/lib/board";
import { formatTicketNumber } from "@/app/lib/format";
import { profileName } from "@/app/lib/people";
import {
  fieldLabel,
  isOneOf,
  TRIAGE_CATEGORIES,
  TRIAGE_PRIORITIES,
  TRIAGE_TEAMS,
} from "@/app/lib/triage-fields";

// The queue card's quick-action menu (SUP-27). One Server Action (CSRF:
// POST + Origin check) for every item; each case reuses the same rules as
// the ticket page and the board, and the database stays the real
// enforcement (RLS, the guard trigger, review_triage(), rate limits).

export type CardActionInput =
  | { kind: "claim" }
  | { kind: "assign"; assigneeId: string | null }
  | { kind: "status"; to: string }
  | { kind: "triage"; field: "priority" | "category" | "team"; value: string }
  | { kind: "flag"; flagged: boolean }
  | { kind: "rerun" };

export type CardActionResult = { ok: true; message: string } | { ok: false; error: string };

const GONE = "This ticket is no longer available to you.";

export async function queueCardAction(ticketId: string, input: CardActionInput): Promise<CardActionResult> {
  const profile = await requireStaff();
  if (!isUuid(ticketId)) {
    return { ok: false, error: GONE };
  }
  // Seen through the caller's own RLS: everything below acts only on a
  // ticket they can see right now.
  const ticket = await getTicketForStaff(ticketId);
  if (!ticket) {
    return { ok: false, error: GONE };
  }
  const label = formatTicketNumber(ticket.number);

  try {
    switch (input.kind) {
      case "claim": {
        const claimed = await claimTicket(profile.id, ticketId);
        return claimed
          ? { ok: true, message: `Claimed ${label}.` }
          : { ok: false, error: `Someone else already claimed ${label}.` };
      }

      case "assign": {
        // Admins only, like the ticket page's Reassign; the assignee must be
        // current staff (the guard trigger rejects anyone else too).
        if (profile.role !== "admin") {
          return { ok: false, error: "Only admins can assign tickets to others." };
        }
        let name = "";
        if (input.assigneeId !== null) {
          const staff = (await listStaffProfiles()).find((s) => s.id === input.assigneeId);
          if (!staff) {
            return { ok: false, error: "That person isn't on the support team." };
          }
          name = staff.id === profile.id ? "you" : profileName(staff);
        }
        const updated = await assignTicket(ticketId, input.assigneeId);
        if (!updated) {
          return { ok: false, error: GONE };
        }
        return { ok: true, message: input.assigneeId ? `Assigned ${label} to ${name}.` : `Unassigned ${label}.` };
      }

      case "status": {
        if (!Object.hasOwn(ALLOWED_STATUS_TRANSITIONS, input.to)) {
          return { ok: false, error: "That move isn't possible." };
        }
        const to = input.to as TicketStatus;
        const moved = await moveTicketAs(profile.id, ticketId, to);
        return moved.ok ? { ok: true, message: `Moved ${label} to ${COLUMN_LABELS[to]}.` } : moved;
      }

      case "triage": {
        const state = ticket.triage_state;
        if (!state?.priority || !state.category || !state.team) {
          return { ok: false, error: `${label} hasn't been triaged yet.` };
        }
        const priority = input.field === "priority" ? input.value : state.priority;
        const category = input.field === "category" ? input.value : state.category;
        const team = input.field === "team" ? input.value : state.team;
        if (!isOneOf(TRIAGE_PRIORITIES, priority) || !isOneOf(TRIAGE_CATEGORIES, category) || !isOneOf(TRIAGE_TEAMS, team)) {
          return { ok: false, error: "Choose one of the listed values." };
        }
        // Recorded as a review of the latest AI run, exactly like the
        // ticket page's form (confirmed if it matches, corrected if not).
        const latest = await getLatestTriageResult(ticketId);
        await reviewTriage(ticketId, latest?.id ?? null, state.reviewed_at, { priority, category, team });
        return { ok: true, message: `Set ${label} ${input.field} to ${fieldLabel(input.value)}.` };
      }

      case "flag": {
        const done = await setFlag(profile.id, ticketId, input.flagged);
        if (!done) {
          return { ok: false, error: GONE };
        }
        return { ok: true, message: input.flagged ? `Flagged ${label} to follow up.` : `Removed the flag from ${label}.` };
      }

      case "rerun": {
        // Two paid model calls: the same per-staff limit as the ticket page.
        await checkRateLimit("rerun_triage");
        await rerunTriage(ticketId);
        return { ok: true, message: `Re-ran AI triage for ${label}.` };
      }
    }
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { ok: false, error: RATE_LIMITED_MESSAGE };
    }
    if (err instanceof TriageReviewError) {
      return {
        ok: false,
        error:
          err.reason === "stale" || err.reason === "stale_review"
            ? `${label}'s triage changed meanwhile. The queue now shows the latest; try again.`
            : GONE,
      };
    }
    console.error(`Queue card action ${input.kind} failed for ${ticketId}:`, err);
    return { ok: false, error: "That didn't work. The queue now shows the ticket's current state." };
  } finally {
    revalidatePath("/queue");
    revalidatePath("/board");
    revalidatePath(`/tickets/${ticketId}`);
  }
}
