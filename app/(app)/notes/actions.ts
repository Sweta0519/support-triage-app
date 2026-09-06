"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { requireStaff } from "@/app/lib/auth/session";
import {
  NOTE_BODY_MAX_LENGTH,
  NOTE_TITLE_MAX_LENGTH,
  createNote,
  deleteNote,
  replaceNoteChunks,
  updateNote,
  type NoteChunk,
} from "@/app/lib/db/notes";
import { isUuid } from "@/app/lib/db/tickets";
import { checkRateLimit, RateLimitError } from "@/app/lib/db/rate-limit";
import { NOTES_EMBEDDING_MODEL, prepareNoteChunks } from "@/app/lib/ai/notes-rag";
import { ASSISTANT_NAME } from "@/app/components/assistant/constants";

const RATE_LIMITED_MESSAGE =
  "You're doing that too often. Please wait a few minutes and try again.";
const INDEXING_FAILED_MESSAGE = `Couldn't index this note for ${ASSISTANT_NAME} just now. Nothing was saved -- please try again.`;

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

// Embedding happens BEFORE any row is written, so a note is never saved
// without its chunks: if OpenRouter is down the user gets an error and
// nothing changes, rather than a note Sage silently can't see.
async function embedOrExplain(
  note: ValidatedNote
): Promise<{ error: string } | { chunks: NoteChunk[] }> {
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
  } catch {
    return { error: INDEXING_FAILED_MESSAGE };
  }
}

export async function createNoteAction(
  _prevState: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  const profile = await requireStaff();

  const validated = validate(formData);
  if ("error" in validated) {
    return { error: validated.error };
  }
  const prepared = await embedOrExplain(validated);
  if ("error" in prepared) {
    return { error: prepared.error };
  }

  const note = await createNote(profile.id, validated.title, validated.body);
  await replaceNoteChunks(note.id, profile.id, prepared.chunks, NOTES_EMBEDDING_MODEL);

  revalidatePath("/notes");
  redirect("/notes");
}

export async function updateNoteAction(
  _prevState: NoteFormState,
  formData: FormData
): Promise<NoteFormState> {
  const profile = await requireStaff();
  const noteId = String(formData.get("noteId") ?? "");
  if (!isUuid(noteId)) {
    return { error: "This note no longer exists." };
  }

  const validated = validate(formData);
  if ("error" in validated) {
    return { error: validated.error };
  }
  const prepared = await embedOrExplain(validated);
  if ("error" in prepared) {
    return { error: prepared.error };
  }

  // RLS scopes the update to the caller's own notes; a null here means
  // nothing visible matched, never that someone else's note was touched.
  const note = await updateNote(noteId, validated.title, validated.body);
  if (!note) {
    return { error: "This note no longer exists." };
  }
  // Old chunks out, freshly embedded ones in -- never stale vectors from
  // the previous version of the note.
  await replaceNoteChunks(note.id, profile.id, prepared.chunks, NOTES_EMBEDDING_MODEL);

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
