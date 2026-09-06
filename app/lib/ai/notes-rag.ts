import "server-only";

import { EMBEDDING_MODEL, embed, embedMany, isAiConfigured, type ToolDefinition } from "./openrouter";
import { matchDocuments, type NoteChunk } from "@/app/lib/db/notes";

// "Chat with your own notes": the retrieval half of Sage. A staff member's
// notes are chunked and embedded when saved (prepareNoteChunks); at chat
// time the model may call the search_notes tool, which embeds the query
// and asks match_documents() for the closest chunks. Per-user scoping is
// not done here -- it is inside match_documents() (auth.uid()) and the
// documents RLS policy, so no code path in this file can widen it.

// ~500 characters with 100 of overlap, per the Supabase guide: the overlap
// carries the tail of the previous chunk so a sentence split by a boundary
// still has its context on both sides.
export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 100;

// Cosine similarity floor for a chunk to count as a match. Lower than the
// 0.75 often quoted for older embedding models: text-embedding-3-small
// scores genuinely relevant passages in the 0.4-0.6 band and unrelated ones
// around 0.1-0.2, so 0.75 would return nothing. See docs/notes-rag.md for
// the calibration measurements behind this value.
export const NOTES_MATCH_THRESHOLD = 0.3;
export const NOTES_MATCH_COUNT = 5;
export const NOTES_QUERY_MAX_LENGTH = 500;

export function chunkText(
  text: string,
  size: number = CHUNK_SIZE,
  overlap: number = CHUNK_OVERLAP
): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);
    if (end < normalized.length) {
      // Prefer to break at a paragraph, sentence or word boundary inside the
      // last `overlap` characters, so chunks don't cut words in half.
      const window = normalized.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
        window.lastIndexOf(" ")
      );
      if (breakAt > size - overlap) {
        end = start + breakAt + 1;
      }
    }
    const chunk = normalized.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= normalized.length) {
      break;
    }
    // Always move forward, even for a pathological chunk shorter than the
    // overlap, so this can't loop forever.
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

// The external, failure-prone step of saving a note, done BEFORE the note
// row is written so a note is never persisted without its index. The title
// is prepended to the text that gets embedded (not to the stored chunk):
// a chunk from the middle of a long note otherwise carries no hint of what
// it is about.
export async function prepareNoteChunks(title: string, body: string): Promise<NoteChunk[]> {
  if (!isAiConfigured()) {
    return [];
  }
  const pieces = chunkText(body);
  const { vectors } = await embedMany(pieces.map((piece) => `${title}\n\n${piece}`));
  return pieces.map((content, chunk_index) => ({
    chunk_index,
    content,
    embedding: vectors[chunk_index],
  }));
}

export { EMBEDDING_MODEL as NOTES_EMBEDDING_MODEL };

export const SEARCH_NOTES_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "search_notes",
    description:
      "Search the current staff member's own private knowledge notes (runbooks, policies, " +
      "saved snippets, customer context) and return the most relevant excerpts. Use it for " +
      "questions about their team's specifics that you could not know otherwise. Do not use it " +
      "for general knowledge, or for things already said in this conversation.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to look for, phrased the way the note would be written -- key terms, not a " +
            "full question. Rewrite and search again if the first results look poor.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
};

export type NotesSearchMatch = {
  note_id: string;
  note_title: string;
  excerpt: string;
  similarity: number;
};

export type NotesSearchResult = {
  query: string;
  matches: NotesSearchMatch[];
};

export async function searchNotes(rawQuery: string): Promise<NotesSearchResult> {
  const query = rawQuery.trim().slice(0, NOTES_QUERY_MAX_LENGTH);
  if (!query) {
    return { query, matches: [] };
  }
  const { vector } = await embed(query);
  const rows = await matchDocuments(vector, NOTES_MATCH_THRESHOLD, NOTES_MATCH_COUNT);
  return {
    query,
    matches: rows.map((row) => ({
      note_id: row.note_id,
      note_title: row.note_title,
      excerpt: row.content,
      similarity: Math.round(row.similarity * 100) / 100,
    })),
  };
}
