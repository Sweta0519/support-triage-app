import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";

export const NOTE_TITLE_MAX_LENGTH = 200;
export const NOTE_BODY_MAX_LENGTH = 20_000;

export type Note = {
  id: string;
  owner_id: string;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
};

export type NoteSummary = Pick<Note, "id" | "title" | "updated_at"> & { preview: string };

const NOTE_COLUMNS = "id, owner_id, title, body, created_at, updated_at";

// Every function here runs with the caller's own session, so RLS (owner +
// staff) decides what comes back -- there is no service-role path to notes
// or their chunks anywhere in the app.

export async function listNotes(): Promise<NoteSummary[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notes")
    .select("id, title, body, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }
  return data.map((note) => ({
    id: note.id,
    title: note.title,
    updated_at: note.updated_at,
    preview: note.body.length > 160 ? `${note.body.slice(0, 160).trimEnd()}...` : note.body,
  }));
}

export async function getNote(id: string): Promise<Note | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export type NoteChunk = {
  chunk_index: number;
  content: string;
  embedding: number[];
};

// One transaction for the note row and its chunks (ticketing.save_note):
// a failure anywhere rolls back everything, so a note can never exist
// without its index or lose its old chunks to a failed re-embed. `noteId`
// null creates; otherwise updates the caller's own note, or returns null
// when nothing visible matched (someone else's note, or a deleted one).
// The caller has already produced the embeddings -- the failure-prone
// external step -- before this runs.
export async function saveNote(
  noteId: string | null,
  title: string,
  body: string,
  chunks: NoteChunk[],
  embeddingModel: string
): Promise<Note | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("save_note", {
    p_id: noteId,
    p_title: title,
    p_body: body,
    p_chunks: chunks,
    p_embedding_model: embeddingModel,
  });

  if (error) {
    throw new Error(error.message);
  }
  return (data as Note | null) ?? null;
}

// Chunks go with it via `on delete cascade` on documents.note_id.
export async function deleteNote(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("notes").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export type DocumentMatch = {
  document_id: string;
  note_id: string;
  note_title: string;
  content: string;
  similarity: number;
};

// The function filters on auth.uid() itself and runs SECURITY INVOKER under
// the documents RLS policy -- the caller's identity comes from the session
// cookie, never from an argument, so there is nothing here to get wrong.
export async function matchDocuments(
  queryEmbedding: number[],
  threshold: number,
  count: number
): Promise<DocumentMatch[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("match_documents", {
    query_embedding: queryEmbedding,
    match_threshold: threshold,
    match_count: count,
  });

  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}
