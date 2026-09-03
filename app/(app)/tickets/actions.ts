"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

import {
  requireAdmin,
  requireProfile,
  requireRole,
  requireStaff,
} from "@/app/lib/auth/session";
import {
  assignTicket,
  createTicket,
  claimTicket,
  getTicketForStaff,
  isUuid,
  updateTicketStatus,
  ALLOWED_STATUS_TRANSITIONS,
  BODY_MAX_LENGTH,
  SUBJECT_MAX_LENGTH,
  type TicketStatus,
} from "@/app/lib/db/tickets";
import { listStaffProfiles } from "@/app/lib/db/profiles";
import { addComment, COMMENT_MAX_LENGTH } from "@/app/lib/db/comments";
import { checkRateLimit, RateLimitError } from "@/app/lib/db/rate-limit";
import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { rerunTriage, runTriage } from "@/app/lib/ai/triage";

const RATE_LIMITED_MESSAGE =
  "You're doing that too often. Please wait a few minutes and try again.";

export type TicketFormState = { error: string } | undefined;

export async function createTicketAction(
  _prevState: TicketFormState,
  formData: FormData
): Promise<TicketFormState> {
  // Tickets are filed by customers; staff work them.
  const profile = await requireRole("customer");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!subject || !body) {
    return { error: "Subject and description are both required." };
  }
  // Mirrors the database check constraints so the user gets a friendly
  // message instead of a constraint-violation error.
  if (subject.length > SUBJECT_MAX_LENGTH) {
    return { error: `Subject must be at most ${SUBJECT_MAX_LENGTH} characters.` };
  }
  if (body.length > BODY_MAX_LENGTH) {
    return { error: `Description must be at most ${BODY_MAX_LENGTH.toLocaleString()} characters.` };
  }

  let ticketId: string;
  try {
    const ticket = await createTicket(profile.id, subject, body);
    ticketId = ticket.id;
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { error: RATE_LIMITED_MESSAGE };
    }
    throw err;
  }

  // Triage runs after the response is sent (after() still fires through the
  // redirect below), so the customer never waits on the model. If the key
  // isn't configured the ticket simply stays `pending` and everything else
  // works.
  if (isAiConfigured()) {
    after(() => runTriage(ticketId));
  }
  redirect(`/tickets/${ticketId}`);
}

export async function rerunTriageAction(formData: FormData) {
  await requireStaff();
  const ticketId = String(formData.get("ticketId") ?? "");
  if (!isUuid(ticketId)) {
    return;
  }
  // Each re-run is two paid model calls, so throttle it per staff member.
  try {
    await checkRateLimit("rerun_triage", 5, 10 * 60);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return;
    }
    throw err;
  }
  // The caller must be able to see this ticket through their own RLS before
  // we touch it with the service role.
  const ticket = await getTicketForStaff(ticketId);
  if (!ticket) {
    return;
  }
  await rerunTriage(ticketId);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/queue");
}

export async function claimTicketAction(formData: FormData) {
  const profile = await requireStaff();
  const ticketId = String(formData.get("ticketId") ?? "");
  if (!isUuid(ticketId)) {
    return;
  }
  const ticket = await claimTicket(profile.id, ticketId);
  if (!ticket) {
    // Someone else claimed it first, or it's no longer visible/valid --
    // either way, show the caller the ticket's current real state rather
    // than pretending the claim succeeded.
    revalidatePath(`/tickets/${ticketId}`);
    return;
  }
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/queue");
}

// Admin-only. An empty assigneeId unassigns. The assignee must be current
// staff -- checked here for a clean no-op, and enforced by the
// guard_ticket_update trigger regardless.
export async function assignTicketAction(formData: FormData) {
  await requireAdmin();
  const ticketId = String(formData.get("ticketId") ?? "");
  const rawAssignee = String(formData.get("assigneeId") ?? "");
  const assigneeId = rawAssignee === "" ? null : rawAssignee;
  if (!isUuid(ticketId) || (assigneeId && !isUuid(assigneeId))) {
    return;
  }

  if (assigneeId) {
    const staff = await listStaffProfiles();
    if (!staff.some((s) => s.id === assigneeId)) {
      return;
    }
  }

  await assignTicket(ticketId, assigneeId);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/queue");
}

export async function updateStatusAction(formData: FormData) {
  await requireStaff();
  const ticketId = String(formData.get("ticketId") ?? "");
  const status = String(formData.get("status") ?? "");
  // The enum and trigger reject bad values anyway; validating here turns a
  // generic 500 into a no-op for tampered forms.
  if (!isUuid(ticketId) || !(status in ALLOWED_STATUS_TRANSITIONS)) {
    return;
  }
  await updateTicketStatus(ticketId, status as TicketStatus);
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath("/queue");
}

export type CommentFormState = { error: string } | undefined;

export async function addCommentAction(
  _prevState: CommentFormState,
  formData: FormData
): Promise<CommentFormState> {
  const profile = await requireProfile();
  const ticketId = String(formData.get("ticketId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const isInternal =
    profile.role !== "customer" && formData.get("isInternal") === "on";

  if (!body) {
    return { error: "Comment can't be empty." };
  }
  if (body.length > COMMENT_MAX_LENGTH) {
    return { error: `Comment must be at most ${COMMENT_MAX_LENGTH.toLocaleString()} characters.` };
  }
  if (!isUuid(ticketId)) {
    return { error: "That ticket doesn't exist." };
  }

  try {
    await addComment(ticketId, profile.id, body, isInternal);
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { error: RATE_LIMITED_MESSAGE };
    }
    throw err;
  }
  revalidatePath(`/tickets/${ticketId}`);
  return undefined;
}
