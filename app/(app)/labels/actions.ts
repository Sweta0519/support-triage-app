"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/app/lib/auth/session";
import { isUuid } from "@/app/lib/db/tickets";
import { createLabel, deleteLabel, LabelNameTakenError, setTicketLabel, updateLabel } from "@/app/lib/db/labels";
import { defaultLabelColor, isLabelColor, labelNameError, type TeamLabel } from "@/app/lib/labels";

// Team labels (SUP-39). Server Actions (CSRF); RLS is the real enforcement.

export type LabelResult = { ok: true; label?: TeamLabel } | { ok: false; error: string };

function refresh(ticketId?: string) {
  revalidatePath("/queue");
  revalidatePath("/board");
  revalidatePath("/labels");
  if (ticketId) revalidatePath(`/tickets/${ticketId}`);
}

export async function createLabelAction(rawName: string, rawColor?: string): Promise<LabelResult> {
  await requireStaff();
  const name = String(rawName ?? "").trim();
  const nameError = labelNameError(name);
  if (nameError) return { ok: false, error: nameError };
  const color = isLabelColor(rawColor) ? rawColor : defaultLabelColor(name);
  try {
    const label = await createLabel(name, color);
    refresh();
    return { ok: true, label };
  } catch (err) {
    if (err instanceof LabelNameTakenError) return { ok: false, error: `A label called "${name}" already exists.` };
    throw err;
  }
}

export async function updateLabelAction(id: string, rawName: string, rawColor: string): Promise<LabelResult> {
  await requireStaff();
  const name = String(rawName ?? "").trim();
  const nameError = labelNameError(name);
  if (!isUuid(id)) return { ok: false, error: "That label no longer exists." };
  if (nameError) return { ok: false, error: nameError };
  if (!isLabelColor(rawColor)) return { ok: false, error: "Choose one of the colours." };
  try {
    await updateLabel(id, { name, color: rawColor });
  } catch (err) {
    if (err instanceof LabelNameTakenError) return { ok: false, error: `A label called "${name}" already exists.` };
    throw err;
  }
  refresh();
  return { ok: true };
}

export async function deleteLabelAction(id: string): Promise<LabelResult> {
  await requireStaff();
  if (!isUuid(id)) return { ok: false, error: "That label no longer exists." };
  await deleteLabel(id);
  refresh();
  return { ok: true };
}

export async function setTicketLabelAction(ticketId: string, labelId: string, on: boolean): Promise<LabelResult> {
  await requireStaff();
  if (!isUuid(ticketId) || !isUuid(labelId) || typeof on !== "boolean") {
    return { ok: false, error: "That change isn't possible." };
  }
  const done = await setTicketLabel(ticketId, labelId, on);
  refresh(ticketId);
  return done ? { ok: true } : { ok: false, error: "This ticket is no longer available to you." };
}

// The picker's "Create “X”": make the label and put it on the ticket.
export async function createAndApplyLabelAction(ticketId: string, rawName: string): Promise<LabelResult> {
  const created = await createLabelAction(rawName);
  if (!created.ok || !created.label) return created;
  const applied = await setTicketLabelAction(ticketId, created.label.id, true);
  return applied.ok ? { ok: true, label: created.label } : applied;
}
