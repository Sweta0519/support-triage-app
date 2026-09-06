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
    .select("id, owner_id, title, body, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

export async function createNote(ownerId: string, title: string, body: string): Promise<Note> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notes")
    .insert({ owner_id: ownerId, title, body })
    .select("id, owner_id, title, body, created_at, updated_at")
    .single();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Returns null when no visible row matched (someone else's note, or a
// deleted one) rather than reporting success for a no-op update.
export async function updateNote(id: string, title: string, body: string): Promise<Note | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("notes")
    .update({ title, body })
    .eq("id", id)
    .select("id, owner_id, title, body, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

// Chunks go with it via `on delete cascade` on documents.note_id.
export async function deleteNote(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("notes").delete().eq("id", id);

  if (error) {
    throw new Error(error.message);
  }
}

export type NoteChunk = {
  chunk_index: number;
  content: string;
  embedding: number[];
};

// Replace, never merge: an edited note's old chunks are deleted first so a
// shorter new version can't leave stale trailing chunks behind. The caller
// has already produced the embeddings (the failure-prone external step)
// before this runs, so the window with no chunks is two quick DB calls.
export async function replaceNoteChunks(
  noteId: string,
  ownerId: string,
  chunks: NoteChunk[],
  embeddingModel: string
): Promise<void> {
  const supabase = await createServerSupabaseClient();

  const { error: deleteError } = await supabase.from("documents").delete().eq("note_id", noteId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }
  if (chunks.length === 0) {
    return;
  }

  const { error: insertError } = await supabase.from("documents").insert(
    chunks.map((chunk) => ({
      note_id: noteId,
      user_id: ownerId,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      embedding: chunk.embedding,
      embedding_model: embeddingModel,
    }))
  );
  if (insertError) {
    throw new Error(insertError.message);
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
