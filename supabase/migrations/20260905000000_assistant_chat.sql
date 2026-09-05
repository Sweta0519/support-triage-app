-- Internal AI assistant chat for staff (agents/admins): a personal
-- scratchpad, separate from the advisory ticket-triage pipeline. Unlike
-- triage_results/ticket_embeddings, conversations only ever need to be
-- visible to their own owner, so ordinary owner-scoped RLS is enough --
-- no service-role table required here.

create table ticketing.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references ticketing.profiles (id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assistant_conversations_owner_id_idx
  on ticketing.assistant_conversations (owner_id, updated_at desc);

create table ticketing.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ticketing.assistant_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 8000),
  model text,
  created_at timestamptz not null default now()
);

create index assistant_messages_conversation_id_idx
  on ticketing.assistant_messages (conversation_id, created_at);

alter table ticketing.assistant_conversations enable row level security;
alter table ticketing.assistant_messages enable row level security;

grant select, insert on ticketing.assistant_conversations to authenticated;
grant select, insert on ticketing.assistant_messages to authenticated;
grant all on ticketing.assistant_conversations to service_role;
grant all on ticketing.assistant_messages to service_role;

create policy "assistant_conversations_owner" on ticketing.assistant_conversations
  for all
  to authenticated
  using (owner_id = (select auth.uid()) and (select ticketing.is_staff()))
  with check (owner_id = (select auth.uid()) and (select ticketing.is_staff()));

-- Messages carry no owner_id of their own; visibility is derived from the
-- parent conversation so there is exactly one place ownership is decided.
create policy "assistant_messages_owner" on ticketing.assistant_messages
  for all
  to authenticated
  using (
    exists (
      select 1 from ticketing.assistant_conversations c
      where c.id = conversation_id and c.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from ticketing.assistant_conversations c
      where c.id = conversation_id and c.owner_id = (select auth.uid())
    )
  );

-- A chat send is a paid model call with no insert trigger to lean on (unlike
-- create_ticket/add_comment), so it needs its own rate-limit case -- same
-- redefine-the-whole-function pattern the previous case additions used.
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
