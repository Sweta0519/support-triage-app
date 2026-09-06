-- Staff knowledge notes and the vector store behind Sage's "search my
-- notes" tool (Turing College Part 7 lab: RAG / chat with your own data).
--
-- A note is a private, per-staff-member document (a runbook, a policy
-- snippet, customer context). On save the app splits it into ~500-char
-- chunks, embeds each with openai/text-embedding-3-small via OpenRouter,
-- and stores the chunks in `documents`. Sage can call match_documents() to
-- pull the closest chunks back as context for an answer.
--
-- Everything here is owner-scoped to `auth.uid()` -- in the policies AND
-- inside match_documents() itself. Unlike ticket_embeddings (deny-all,
-- service role only) these tables are read and written with the caller's
-- own session, so RLS is the thing that keeps one agent's notes out of
-- another agent's chat, not app code.

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------

create table ticketing.notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references ticketing.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index notes_owner_id_idx on ticketing.notes (owner_id, updated_at desc);

create trigger notes_set_updated_at
  before update on ticketing.notes
  for each row execute function ticketing.set_updated_at();

alter table ticketing.notes enable row level security;

-- Column-level privileges, same idea as tickets: the client may only ever
-- supply owner/title/body on insert and title/body on update -- never
-- `id`, the timestamps, or (on update) a new owner.
grant select, delete on ticketing.notes to authenticated;
grant insert (owner_id, title, body) on ticketing.notes to authenticated;
grant update (title, body) on ticketing.notes to authenticated;
grant all on ticketing.notes to service_role;

create policy "notes_owner" on ticketing.notes
  for all
  to authenticated
  using (owner_id = (select auth.uid()) and (select ticketing.is_staff()))
  with check (owner_id = (select auth.uid()) and (select ticketing.is_staff()));

-- ---------------------------------------------------------------------------
-- documents (the chunks + embeddings)
-- ---------------------------------------------------------------------------

-- Named `documents` after the Supabase semantic-search guide this follows.
-- One row per chunk. `user_id` is denormalised from notes.owner_id so the
-- similarity search can filter on it without a join, and so the RLS
-- policy is a plain column comparison.
create table ticketing.documents (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references ticketing.notes (id) on delete cascade,
  user_id uuid not null references ticketing.profiles (id) on delete cascade,
  chunk_index int not null check (chunk_index >= 0),
  content text not null check (char_length(content) between 1 and 2000),
  -- Must match EMBEDDING_DIMENSIONS in app/lib/ai/openrouter.ts. Pinned:
  -- changing the embedding model means dropping and re-embedding every
  -- row, never just swapping the slug.
  embedding extensions.vector(1536) not null,
  embedding_model text not null,
  created_at timestamptz not null default now(),
  unique (note_id, chunk_index)
);

create index documents_user_id_idx on ticketing.documents (user_id);

create index documents_embedding_idx on ticketing.documents
  using hnsw (embedding extensions.vector_cosine_ops);

alter table ticketing.documents enable row level security;

-- No update: chunks are immutable -- editing a note deletes its chunks and
-- inserts freshly embedded ones, so stale vectors can't linger.
grant select, insert, delete on ticketing.documents to authenticated;
grant all on ticketing.documents to service_role;

-- A chunk must belong to the caller AND to a note the caller owns; the
-- second condition stops a client from attaching chunks to someone else's
-- note id (which would otherwise be a way to make text appear under that
-- note's title in your own searches -- harmless-looking, but wrong).
create policy "documents_owner" on ticketing.documents
  for all
  to authenticated
  using (user_id = (select auth.uid()) and (select ticketing.is_staff()))
  with check (
    user_id = (select auth.uid())
    and (select ticketing.is_staff())
    and exists (
      select 1 from ticketing.notes n
      where n.id = note_id and n.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- match_documents
-- ---------------------------------------------------------------------------

-- Nearest chunks by cosine distance (`<=>`), above a similarity threshold,
-- for the CALLING user only. There is deliberately no user-id parameter:
-- the guide's version takes one, but a parameter the client supplies is a
-- parameter the client can lie about. Scoping to auth.uid() here, on top
-- of the RLS policy above (SECURITY INVOKER, so the policy applies inside
-- the function too), means there is no request shape that returns another
-- staff member's chunks.
create or replace function ticketing.match_documents(
  query_embedding extensions.vector(1536),
  match_threshold float,
  match_count int
)
returns table (
  document_id uuid,
  note_id uuid,
  note_title text,
  content text,
  similarity float
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    d.id,
    d.note_id,
    n.title,
    d.content,
    1 - (d.embedding operator(extensions.<=>) query_embedding) as similarity
  from ticketing.documents d
  join ticketing.notes n on n.id = d.note_id
  where d.user_id = (select auth.uid())
    and 1 - (d.embedding operator(extensions.<=>) query_embedding) > match_threshold
  order by d.embedding operator(extensions.<=>) query_embedding asc
  limit least(greatest(match_count, 1), 10);
$$;

-- Default privileges in this schema already withhold EXECUTE from PUBLIC
-- (20260903060000_audit_fixes.sql); the revoke is belt-and-braces and the
-- grant is what actually lets a signed-in staff member call it.
revoke all on function ticketing.match_documents(extensions.vector, float, int) from public;
grant execute on function ticketing.match_documents(extensions.vector, float, int) to authenticated;

-- ---------------------------------------------------------------------------
-- assistant_messages.metadata
-- ---------------------------------------------------------------------------

-- What Sage did behind a reply -- today `{"searches": [{"query", "matches"}]}`
-- -- so the widget can show "searched your notes" and a test can tell a
-- retrieved answer from a direct one. Stored with the reply rather than in
-- its own table because it is display-only and always read with the row.
alter table ticketing.assistant_messages
  add column metadata jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- rate limit: save_note
-- ---------------------------------------------------------------------------

-- Saving a note is a paid embedding call (up to ~50 chunks for a max-length
-- body), so it gets its own bucket -- same redefine-the-whole-function
-- pattern every previous case addition used.
create or replace function ticketing.consume_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_window_seconds int;
  v_key text;
  v_window_start timestamptz;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  case p_action
    when 'create_ticket' then v_limit := 10; v_window_seconds := 3600;
    when 'add_comment'   then v_limit := 30; v_window_seconds := 600;
    when 'rerun_triage'  then v_limit := 5;  v_window_seconds := 600;
    when 'assistant_message' then v_limit := 20; v_window_seconds := 600;
    when 'save_note'     then v_limit := 30; v_window_seconds := 600;
    else raise exception 'unknown rate limit action';
  end case;

  v_key := auth.uid()::text || ':' || p_action;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds
  );

  insert into ticketing.rate_limits (key, window_start, count)
  values (v_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= v_limit;
end;
$$;
