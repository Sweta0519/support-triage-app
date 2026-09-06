-- Two fixes to 20260906000000_staff_notes_rag.sql from the pre-merge review.
--
-- 1. Saving a note was two autocommitted Data API calls -- insert/update
--    the note, then delete+insert its chunks. A failure between them left
--    a note with no chunks (silently invisible to Sage) or, on edit, a
--    previously searchable note un-indexed, and two concurrent edits could
--    interleave their delete/insert and trip unique (note_id, chunk_index).
--    save_note() does the whole thing in one transaction.
--
-- 2. The global HNSW index on documents.embedding was wrong for a per-user
--    search. pgvector's index scan fetches the ef_search (default 40)
--    globally nearest rows and only then applies the `user_id = auth.uid()`
--    filter, so once colleagues' similar notes dominate the neighbourhood a
--    user's own relevant chunk can be dropped from the result entirely --
--    and RLS predicates are post-filtered the same way. Each user has at
--    most a few hundred chunks, so an exact scan over documents_user_id_idx
--    is both correct and fast. (If that ever stops being true, the answer
--    is pgvector >= 0.8's iterative index scans, not the plain index.)

drop index if exists ticketing.documents_embedding_idx;

-- SECURITY INVOKER on purpose: the caller's RLS and column privileges on
-- notes/documents apply inside exactly as they would to direct writes, and
-- auth.uid() -- not an argument -- is the owner. p_id null creates; a uuid
-- updates the caller's own note or returns null when nothing visible matched.
create or replace function ticketing.save_note(
  p_id uuid,
  p_title text,
  p_body text,
  p_chunks jsonb,
  p_embedding_model text
)
returns ticketing.notes
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_note ticketing.notes;
begin
  if p_chunks is null or jsonb_typeof(p_chunks) <> 'array' then
    raise exception 'p_chunks must be a JSON array';
  end if;

  if p_id is null then
    insert into ticketing.notes (owner_id, title, body)
    values (auth.uid(), p_title, p_body)
    returning * into v_note;
  else
    update ticketing.notes
    set title = p_title, body = p_body
    where id = p_id
    returning * into v_note;
    if not found then
      return null;
    end if;
  end if;

  -- Replace, never merge: no stale chunks from the previous version.
  delete from ticketing.documents where note_id = v_note.id;

  insert into ticketing.documents (note_id, user_id, chunk_index, content, embedding, embedding_model)
  select
    v_note.id,
    v_note.owner_id,
    (c->>'chunk_index')::int,
    c->>'content',
    (c->>'embedding')::extensions.vector(1536),
    p_embedding_model
  from jsonb_array_elements(p_chunks) as c;

  return v_note;
end;
$$;

revoke all on function ticketing.save_note(uuid, text, text, jsonb, text) from public;
grant execute on function ticketing.save_note(uuid, text, text, jsonb, text) to authenticated;
