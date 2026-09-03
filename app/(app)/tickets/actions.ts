"use server";

import { redirect } from "next/navigation";

import { requireProfile } from "@/app/lib/auth/session";
import { createTicket } from "@/app/lib/db/tickets";

export type TicketFormState = { error: string } | undefined;

export async function createTicketAction(
  _prevState: TicketFormState,
  formData: FormData
): Promise<TicketFormState> {
  const profile = await requireProfile();
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!subject || !body) {
    return { error: "Subject and description are both required." };
  }

  const ticket = await createTicket(profile.id, subject, body);
  redirect(`/tickets/${ticket.id}`);
}
