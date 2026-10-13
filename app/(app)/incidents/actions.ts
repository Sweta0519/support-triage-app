"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/app/lib/auth/session";
import { addComment } from "@/app/lib/db/comments";
import { closeIncident, getIncident, listIncidentTickets, recordIncidentUpdatePosted } from "@/app/lib/db/incidents";
import { RateLimitError, RATE_LIMITED_MESSAGE } from "@/app/lib/db/rate-limit";
import { isUuid } from "@/app/lib/db/tickets";
import { canMove } from "@/app/lib/board";
import { INCIDENT_UPDATE_MAX_LENGTH } from "@/app/lib/incidents";
import { moveTicketAs } from "@/app/lib/ticket-moves";

// Incident actions (SUP-42). Server Actions (CSRF); RLS is the real
// enforcement. Each acts only on the grouped tickets the caller can see, and
// only when a person presses the button -- nothing here runs on its own.

export type IncidentActionResult = { ok: true; message: string } | { ok: false; error: string };

const GONE = "This incident is no longer open.";

function refresh(incidentId: string) {
  revalidatePath("/incidents");
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath("/queue");
  revalidatePath("/board");
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Posts one public reply on every open ticket in the incident the caller can
// see. Tickets they can't see (another agent's) are left out and counted.
export async function postIncidentUpdateAction(incidentId: string, rawBody: string): Promise<IncidentActionResult> {
  const profile = await requireStaff();
  const body = String(rawBody ?? "").trim();
  if (!isUuid(incidentId)) return { ok: false, error: GONE };
  if (!body) return { ok: false, error: "Write the update first." };
  if (body.length > INCIDENT_UPDATE_MAX_LENGTH) {
    return { ok: false, error: `Keep the update under ${INCIDENT_UPDATE_MAX_LENGTH} characters.` };
  }
  const incident = await getIncident(incidentId);
  if (!incident || incident.status !== "open") return { ok: false, error: GONE };

  const tickets = (await listIncidentTickets(incidentId)).filter((t) => t.status !== "resolved" && t.status !== "closed");
  if (tickets.length === 0) return { ok: false, error: "None of this incident's open tickets are yours to reply to." };
  let posted = 0;
  try {
    for (const ticket of tickets) {
      await addComment(ticket.id, profile.id, body, false);
      posted++;
    }
  } catch (err) {
    refresh(incidentId);
    if (err instanceof RateLimitError) {
      return { ok: false, error: `Posted to ${plural(posted, "ticket")}, then: ${RATE_LIMITED_MESSAGE}` };
    }
    console.error(`Incident ${incidentId} update failed after ${posted} posts:`, err);
    return { ok: false, error: `Posted to ${plural(posted, "ticket")}, then something went wrong. Try again for the rest.` };
  }
  await recordIncidentUpdatePosted(incidentId, profile.id, body);
  refresh(incidentId);
  return { ok: true, message: `Posted the update to ${plural(posted, "ticket")}.` };
}

// Resolves the incident; with `alsoResolveTickets`, also moves each of its
// tickets the caller can see to Resolved where that move is allowed (from In
// progress), and says how many were left as they were.
export async function resolveIncidentAction(incidentId: string, alsoResolveTickets: boolean): Promise<IncidentActionResult> {
  const profile = await requireStaff();
  if (!isUuid(incidentId) || typeof alsoResolveTickets !== "boolean") return { ok: false, error: GONE };
  const tickets = alsoResolveTickets ? await listIncidentTickets(incidentId) : [];
  if (!(await closeIncident(incidentId, "resolved", profile.id))) return { ok: false, error: GONE };

  let resolved = 0;
  let left = 0;
  for (const ticket of tickets) {
    if (ticket.status === "resolved" || ticket.status === "closed") continue;
    if (!canMove(ticket.status, "resolved")) {
      left++;
      continue;
    }
    const moved = await moveTicketAs(profile.id, ticket.id, "resolved");
    if (moved.ok) resolved++;
    else left++;
  }
  refresh(incidentId);
  for (const ticket of tickets) revalidatePath(`/tickets/${ticket.id}`);
  if (!alsoResolveTickets) return { ok: true, message: "Resolved the incident. Its tickets are unchanged." };
  return {
    ok: true,
    message:
      `Resolved the incident and ${plural(resolved, "ticket")}.` +
      (left ? ` ${plural(left, "ticket")} weren't in progress, so they were left as they were.` : ""),
  };
}

// A false alarm: the incident closes and its markers go. Its tickets stay
// linked to it, so the same burst can't open a new incident a minute later.
export async function dismissIncidentAction(incidentId: string): Promise<IncidentActionResult> {
  const profile = await requireStaff();
  if (!isUuid(incidentId) || !(await closeIncident(incidentId, "dismissed", profile.id))) {
    return { ok: false, error: GONE };
  }
  refresh(incidentId);
  return { ok: true, message: "Dismissed as a false alarm." };
}
