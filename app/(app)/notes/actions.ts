"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireStaff } from "@/app/lib/auth/session";
import {
  NOTE_BODY_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  deleteNote,
  getNote,
  saveNote,
  type NoteChunk,
} from "@/app/lib/db/notes";
import { isUuid } from "@/app/lib/db/tickets";
import { checkRateLimit, RATE_LIMITED_MESSAGE, RateLimitError } from "@/app/lib/db/rate-limit";
import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { NOTES_EMBEDDING_MODEL, prepareNoteChunks } from "@/app/lib/ai/notes-rag";
import { ASSISTANT_NAME } from "@/app/components/assistant/constants";

const AI_UNAVAILABLE_MESSAGE = `Notes can't be saved right now: the AI service ${ASSISTANT_NAME} uses to index them isn't configured.`;
const INDEXING_FAILED_MESSAGE = `Couldn't index this note for ${ASSISTANT_NAME} just now. Nothing was saved -- please try again.`;
const NOTE_GONE_MESSAGE = "This note no longer exists.";

export type NoteFormState = { error?: string; saved?: boolean } | undefined;

type ValidatedNote = { title: string; body: string };

function validate(formData: FormData): { error: string } | ValidatedNote {
  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!title || !body) {
    return { error: "Title and note text are both required." };
  }
  // Mirrors the database check constraints so the user gets a friendly
  // message instead of a constraint-violation error.
  if (title.length > NOTE_TITLE_MAX_LENGTH) {
    return { error: `Title must be at most ${NOTE_TITLE_MAX_LENGTH} characters.` };
  }
  if (body.length > NOTE_BODY_MAX_LENGTH) {
    return { error: `Note must be at most ${NOTE_BODY_MAX_LENGTH.toLocaleString()} characters.` };
  }
  return { title, body };
}

// Embedding happens BEFORE anything is written, and the write itself is one
// transaction (save_note), so a note is never persisted without its chunks:
// if OpenRouter is down or unconfigured the user gets an error and nothing
// changes, rather than a note Sage silently can't see.
async function embedOrExplain(
  note: ValidatedNote
): Promise<{ error: string } | { chunks: NoteChunk[] }> {
  if (!isAiConfigured()) {
    return { error: AI_UNAVAILABLE_MESSAGE };
  }
  try {
    await checkRateLimit("save_note");
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { error: RATE_LIMITED_MESSAGE };
    }
    throw err;
  }
  try {
    return { chunks: await prepareNoteChunks(note.title, note.body) };
  } catch (err) {
    console.error("Note embedding failed", err);
    return { error: INDEXING_FAILED_MESSAGE };
  }
}

export async function createNoteAction(
  _prevState: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  await requireStaff();

  const validated = validate(formData);
  if ("error" in validated) {
    return { error: validated.error };
  }
  const prepared = await embedOrExplain(validated);
  if ("error" in prepared) {
    return { error: prepared.error };
  }

  await saveNote(null, validated.title, validated.body, prepared.chunks, NOTES_EMBEDDING_MODEL);

  revalidatePath("/notes");
  redirect("/notes");
}

export async function updateNoteAction(
  _prevState: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  await requireStaff();
  const noteId = String(formData.get("noteId") ?? "");
  if (!isUuid(noteId)) {
    return { error: NOTE_GONE_MESSAGE };
  }

  const validated = validate(formData);
  if ("error" in validated) {
    return { error: validated.error };
  }

  // One RLS-scoped read before paying for an embedding: a stale tab for a
  // deleted note (or a URL with someone else's id) gets its answer for
  // free, and a save that changes nothing skips the re-embed entirely.
  const existing = await getNote(noteId);
  if (!existing) {
    return { error: NOTE_GONE_MESSAGE };
  }
  if (existing.title === validated.title && existing.body === validated.body) {
    return { saved: true };
  }

  const prepared = await embedOrExplain(validated);
  if ("error" in prepared) {
    return { error: prepared.error };
  }

  // Old chunks out, freshly embedded ones in, in the same transaction as
  // the note update -- never stale vectors from the previous version, and
  // never a note left un-indexed by a failure half-way.
  const note = await saveNote(
    noteId,
    validated.title,
    validated.body,
    prepared.chunks,
    NOTES_EMBEDDING_MODEL
  );
  if (!note) {
    return { error: NOTE_GONE_MESSAGE };
  }

  revalidatePath("/notes");
  revalidatePath(`/notes/${note.id}`);
  return { saved: true };
}

export async function deleteNoteAction(formData: FormData) {
  await requireStaff();
  const noteId = String(formData.get("noteId") ?? "");
  if (!isUuid(noteId)) {
    return;
  }
  // Chunks cascade with the note (documents.note_id on delete cascade).
  await deleteNote(noteId);
  revalidatePath("/notes");
  redirect("/notes");
}
