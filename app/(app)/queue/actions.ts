"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/app/lib/auth/session";
import { assignTicket, claimTicket, DailyCapError, getTicketForStaff, isUuid, type TicketStatus } from "@/app/lib/db/tickets";
import { listStaffProfiles } from "@/app/lib/db/profiles";
import { setFlag } from "@/app/lib/db/flags";
import { checkRateLimit, RATE_LIMITED_MESSAGE, RateLimitError } from "@/app/lib/db/rate-limit";
import { reviewTriage, TriageReviewError } from "@/app/lib/db/triage";
import { rerunTriage } from "@/app/lib/ai/triage";
import { moveTicketAs } from "@/app/lib/ticket-moves";
import { ALLOWED_STATUS_TRANSITIONS } from "@/app/lib/ticket-status";
import { COLUMN_LABELS } from "@/app/lib/board";
import { formatTicketNumber } from "@/app/lib/format";
import { profileName } from "@/app/lib/people";
import { canRerunTriage, effectiveTriageStatus } from "@/app/lib/triage-status";
import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { setTicketLabel } from "@/app/lib/db/labels";
import { DAILY_CAP_SELF_MESSAGE, dailyCapAssigneeMessage } from "@/app/lib/workload";
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
  | {
      kind: "triage";
      field: "priority" | "category" | "team";
      value: string;
      // What the card showed, so review_triage() can refuse a review made
      // over a newer AI run or someone else's newer review -- exactly like
      // the ticket page's form, which sends the same three things.
      shown: { priority: string; category: string; team: string };
      resultId: string | null;
      reviewedAt: string | null;
    }
  | { kind: "flag"; flagged: boolean }
  | { kind: "label"; labelId: string; on: boolean }
  | { kind: "rerun" };

export type CardActionResult = { ok: true; message: string } | { ok: false; error: string };

const GONE = "This ticket is no longer available to you.";

const TRIAGE_FIELDS = ["priority", "category", "team"] as const;

// The TypeScript type isn't enforced at runtime, and a Server Action is a
// public endpoint: check the shape before acting on it.
function isCardActionInput(value: unknown): value is CardActionInput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const str = (x: unknown) => typeof x === "string";
  switch (v.kind) {
    case "claim":
    case "rerun":
      return true;
    case "assign":
      return v.assigneeId === null || (str(v.assigneeId) && isUuid(v.assigneeId as string));
    case "status":
      return str(v.to);
    case "flag":
      return typeof v.flagged === "boolean";
    case "label":
      return str(v.labelId) && isUuid(v.labelId as string) && typeof v.on === "boolean";
    case "triage": {
      const shown = v.shown as Record<string, unknown> | null;
      return (
        isOneOf(TRIAGE_FIELDS, String(v.field)) &&
        str(v.value) &&
        typeof shown === "object" &&
        shown !== null &&
        TRIAGE_FIELDS.every((f) => str(shown[f])) &&
        (v.resultId === null || str(v.resultId)) &&
        (v.reviewedAt === null || str(v.reviewedAt))
      );
    }
    default:
      return false;
  }
}

export async function queueCardAction(ticketId: string, input: CardActionInput): Promise<CardActionResult> {
  const profile = await requireStaff();
  if (!isUuid(ticketId) || !isCardActionInput(input)) {
    return { ok: false, error: "That action isn't possible." };
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
          : { ok: false, error: `Couldn't claim ${label}: someone else got it first, or it's no longer open.` };
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
        let updated;
        try {
          updated = await assignTicket(ticketId, input.assigneeId);
        } catch (err) {
          if (err instanceof DailyCapError) {
            return { ok: false, error: input.assigneeId === profile.id ? DAILY_CAP_SELF_MESSAGE : dailyCapAssigneeMessage(name) };
          }
          throw err;
        }
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
        const moved = await moveTicketAs(profile.id, ticketId, to, ticket);
        return moved.ok ? { ok: true, message: `Moved ${label} to ${COLUMN_LABELS[to]}.` } : moved;
      }

      case "triage": {
        const values = { ...input.shown, [input.field]: input.value };
        const { priority, category, team } = values;
        if (
          !isOneOf(TRIAGE_PRIORITIES, priority) ||
          !isOneOf(TRIAGE_CATEGORIES, category) ||
          !isOneOf(TRIAGE_TEAMS, team) ||
          (input.resultId !== null && !isUuid(input.resultId)) ||
          (input.reviewedAt !== null && Number.isNaN(Date.parse(input.reviewedAt)))
        ) {
          return { ok: false, error: "Choose one of the listed values." };
        }
        // Recorded as a review of the AI run the card showed, exactly like
        // the ticket page's form (confirmed if it matches, else corrected).
        await reviewTriage(ticketId, input.resultId, input.reviewedAt, { priority, category, team });
        return { ok: true, message: `Set ${label} ${input.field} to ${fieldLabel(input.value)}.` };
      }

      case "flag": {
        const done = await setFlag(profile.id, ticketId, input.flagged);
        if (!done) {
          return { ok: false, error: GONE };
        }
        return { ok: true, message: input.flagged ? `Flagged ${label} to follow up.` : `Removed the flag from ${label}.` };
      }

      case "label": {
        const done = await setTicketLabel(ticketId, input.labelId, input.on);
        if (done === "label_gone") return { ok: false, error: "That label was deleted meanwhile." };
        if (done === "ticket_gone") return { ok: false, error: GONE };
        return { ok: true, message: input.on ? `Added the label to ${label}.` : `Removed the label from ${label}.` };
      }

      case "rerun": {
        // A run that's still going isn't reset (it would race the live
        // one), so say so rather than reporting a re-run that didn't happen.
        if (!isAiConfigured()) {
          return { ok: false, error: "AI triage isn't configured, so it can't be re-run." };
        }
        const status = effectiveTriageStatus(ticket.triage_state);
        if (!canRerunTriage(status)) {
          return { ok: false, error: `AI triage for ${label} is already running.` };
        }
        // Two paid model calls: the same per-staff limit as the ticket page.
        await checkRateLimit("rerun_triage");
        await rerunTriage(ticketId);
        return { ok: true, message: `Re-ran AI triage for ${label}.` };
      }
    }
    return { ok: false, error: "That action isn't possible." };
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { ok: false, error: RATE_LIMITED_MESSAGE };
    }
    // A claim refused by the daily cap (SUP-77).
    if (err instanceof DailyCapError) {
      return { ok: false, error: DAILY_CAP_SELF_MESSAGE };
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
