# PR #5 review: staff notes + agentic RAG for Sage

`/code-review main high` run on the `feature/notes-rag` diff before merge (the `ai-code-reviewer`
subagent named in CLAUDE.md is not configured in this repo, so the code-review skill stands in, as
it did for PR #4). Eight finder angles, 14 verifiers, ~26 deduped candidates; two refuted by the
reviewer itself (the test-reset scope -- test accounts are documented as disposable -- and a
`deleteNote` rowcount check, which is pure style for an idempotent delete). The ten reported
findings and what was done about each:

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Note create/update and chunk replacement were separate autocommitted calls: a chunk-insert failure left an orphan note with no chunks (or, on edit, stripped a searchable note of its index), and concurrent edits could interleave. | Correctness | **Fixed** -- new migration `20260906010000_save_note_rpc.sql`: `ticketing.save_note()` (SECURITY INVOKER) upserts the note and replaces its chunks in one transaction. `createNote`/`updateNote`/`replaceNoteChunks` removed in favour of `saveNote()`. |
| 2 | Global HNSW index + per-user `WHERE`: pgvector post-filters the `ef_search` (40) globally nearest rows, so a user's own relevant chunk can be dropped once colleagues' chunks dominate the neighbourhood. Invisible to a two-user test. | Correctness | **Fixed** -- index dropped in the same migration; exact scan via `documents_user_id_idx` over a few hundred rows per user. Reasoning recorded in `docs/notes-rag.md`. |
| 3 | Forced final completion (`tool_choice: "none"`) returned `final.text` unchecked; a provider that still emits tool calls yields `""`, which fails `assistant_messages`' non-empty check after four paid completions. | Correctness | **Fixed** -- empty final text is replaced by a fixed "couldn't put together an answer" reply. |
| 4 | `prepareNoteChunks` returned `[]` when the API key was unset, so notes were silently saved un-indexed (and existing chunks deleted on edit) with no re-index path. | Correctness | **Fixed** -- it throws; the actions check `isAiConfigured()` up front and refuse to save with a clear message. |
| 5 | `chunkText` sliced by UTF-16 code unit and could split a surrogate pair (verified with `"日" + "😀".repeat(600)`), producing lone surrogates Postgres rejects. | Correctness | **Fixed** -- the cut never lands between a high and low surrogate; re-verified with the same input (0 lone surrogates, JSON round-trips). Also: boundary preference is now a real order (paragraph > sentence > line > word) and the overlap start snaps to a word boundary. |
| 6 | `embedMany` filled `vectors[item.index ?? position]` with no hole check, so an out-of-range/duplicate provider `index` passed the length check and `embed()` returned `undefined` -- a regression from the old `embed()`. | Correctness | **Fixed** -- rejects out-of-range or duplicate indices and any unfilled slot. |
| 7 | Every tool call in a round ran, uncapped, so one `assistant_message` token could cover an unbounded number of embeddings; the doc's "1-3 embedding calls" was wrong. | Efficiency / cost | **Fixed** -- at most 2 calls per round (dropped calls are not put in the transcript, so every tool call still gets a result), run with `Promise.all`; bound is now 4 completions + 6 embeddings per message, documented. |
| 8 | `tool_calls` filter checked only `type` and `function.name`, so a call without an `id` became a `tool` message with `tool_call_id: undefined` and a 400 on the next request. | Correctness | **Fixed** -- filter requires string `id`, `function.name` and `function.arguments`. |
| 9 | `updateNoteAction` consumed a rate-limit token and paid a full embedding before learning the note was gone, and re-embedded unchanged saves. | Efficiency | **Fixed** -- one RLS-scoped `getNote()` first; missing -> error for free, unchanged -> `saved` without embedding. |
| 10 | System prompt's catch-all retrieval clause was garbled ("or a specific you could not know."). | Prompt quality | **Fixed** -- "or any specific detail you could not otherwise know." |

Lower-severity cleanups the reviewer listed below the cap, and their status: `chunkText` comment
vs behaviour (fixed with #5); `runToolCall`'s "never an exception" claim (now true -- `searchNotes`
failures are caught and returned to the model as an error string); `embedOrExplain` swallowing
errors silently (now logs); `RATE_LIMITED_MESSAGE` declared in three files (moved to
`app/lib/db/rate-limit.ts`); missing `NOTE_COLUMNS` constant (added). Left as-is, knowingly:
`listNotes` selecting full bodies for a 160-char preview (PostgREST cannot substring; bodies are
capped at 20 KB and the list is per-user); `notes-rag.spec.ts` and `ai-chat.spec.ts` sharing one
Sage conversation under local `fullyParallel` (both are written to tolerate it and CI runs one
worker); per-turn `usage.cost_usd` not persisted for Sage (pre-existing; triage is the costed
feature); `openSage` / `createClient` helpers duplicated across test files.

After the fixes: `tsc` and `eslint` clean; full Playwright suite 20/20 passing against the live
project with the two new migrations applied.
