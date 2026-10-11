-- SUP-23: profile pictures.
--
-- Pictures live in a private Storage bucket, ticketing-avatars (this
-- project shares its Supabase project with notes-collections, hence the
-- prefix). The app resizes every upload to a 256px WebP with sharp before
-- it is stored, so the bucket only ever holds small WebP files.
--
-- Object names are <owner uid>/<random uuid>.webp. A new upload always
-- gets a new name (no overwrite), so a picture's URL can be cached forever
-- and replacing it is "upload new, point the profile at it, delete old".

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticketing-avatars', 'ticketing-avatars', false, 524288, array['image/webp'])
on conflict (id) do nothing;

-- Any signed-in user may read pictures (they show next to names across the
-- app); only the owner may add or remove objects in their own folder. No
-- UPDATE policy: objects are never overwritten.
create policy "ticketing_avatars_select" on storage.objects
  for select
  to authenticated
  using (bucket_id = 'ticketing-avatars');

create policy "ticketing_avatars_insert_own" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'ticketing-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "ticketing_avatars_delete_own" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'ticketing-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- The profile points at the current picture. Its shape ties it to the row's
-- own folder, so a profile can never point at someone else's picture.
alter table ticketing.profiles
  add column avatar_path text
    constraint profiles_avatar_path_check check (
      avatar_path is null
      or (
        avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'
        and split_part(avatar_path, '/', 1) = id::text
      )
    );

-- New action 'update_avatar', 10 per 10 minutes, charged by the app before
-- it resizes anything (the costly part). Same redefine-the-whole-function
-- pattern as every earlier case addition.
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
    when 'staff_create_ticket' then v_limit := 30; v_window_seconds := 3600;
    when 'add_comment'   then v_limit := 30; v_window_seconds := 600;
    when 'rerun_triage'  then v_limit := 5;  v_window_seconds := 600;
    when 'assistant_message' then v_limit := 20; v_window_seconds := 600;
    when 'save_note'     then v_limit := 30; v_window_seconds := 600;
    when 'rate_ticket'   then v_limit := 10; v_window_seconds := 600;
    when 'update_profile' then v_limit := 20; v_window_seconds := 600;
    when 'update_avatar' then v_limit := 10; v_window_seconds := 600;
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

-- The only way to set or clear one's own picture (authenticated has no
-- UPDATE on profiles). Always the caller's row; a new path must be in the
-- caller's folder and already uploaded. Returns the previous path so the
-- app can delete that object.
create or replace function ticketing.set_own_avatar(p_path text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if p_path is not null then
    if p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$' or split_part(p_path, '/', 1) <> v_uid::text then
      raise exception 'invalid_avatar_path' using errcode = '22023';
    end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'ticketing-avatars' and o.name = p_path
    ) then
      raise exception 'avatar_not_uploaded' using errcode = '22023';
    end if;
  end if;

  select p.avatar_path into v_old from ticketing.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update ticketing.profiles
  set avatar_path = p_path, updated_at = now()
  where id = v_uid;

  return v_old;
end;
$$;

revoke all on function ticketing.set_own_avatar(text) from public;
grant execute on function ticketing.set_own_avatar(text) to authenticated;

-- The data export now includes the picture's path.
create or replace function ticketing.export_own_data()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'profile', (
      select jsonb_build_object(
        'id', p.id, 'email', p.email, 'full_name', p.full_name,
        'role', p.role, 'created_at', p.created_at,
        'avatar_path', p.avatar_path,
        'preferences', jsonb_build_object(
          'theme', p.theme,
          'queue_default_filter', p.queue_default_filter,
          'queue_default_sort', p.queue_default_sort
        )
      )
      from ticketing.profiles p
      where p.id = (select auth.uid())
    ),
    'tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'subject', t.subject, 'body', t.body, 'status', t.status,
        'created_at', t.created_at, 'updated_at', t.updated_at,
        'first_response_at', t.first_response_at, 'resolved_at', t.resolved_at,
        'closed_at', t.closed_at,
        'comments', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', c.id, 'body', c.body,
            'by_me', c.author_id = (select auth.uid()),
            'created_at', c.created_at
          ) order by c.created_at), '[]'::jsonb)
          from ticketing.ticket_comments c
          where c.ticket_id = t.id
        ),
        'history', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'event_type', e.event_type, 'from', e.from_value, 'to', e.to_value,
            'created_at', e.created_at
          ) order by e.created_at), '[]'::jsonb)
          from ticketing.ticket_events e
          where e.ticket_id = t.id
        )
      ) order by t.created_at), '[]'::jsonb)
      from ticketing.tickets t
      where t.customer_id = (select auth.uid())
    ),
    'comments_on_other_tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'ticket_id', c.ticket_id, 'body', c.body,
        'is_internal', c.is_internal, 'created_at', c.created_at
      ) order by c.created_at), '[]'::jsonb)
      from ticketing.ticket_comments c
      join ticketing.tickets t on t.id = c.ticket_id
      where c.author_id = (select auth.uid())
        and t.customer_id <> (select auth.uid())
    ),
    'actions_on_tickets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticket_id', e.ticket_id, 'event_type', e.event_type,
        'from', e.from_value, 'to', e.to_value, 'created_at', e.created_at
      ) order by e.created_at), '[]'::jsonb)
      from ticketing.ticket_events e
      where e.actor_id = (select auth.uid())
    ),
    'tickets_assigned_to_me', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'subject', t.subject, 'status', t.status
      ) order by t.created_at), '[]'::jsonb)
      from ticketing.tickets t
      where t.assignee_id = (select auth.uid())
    ),
    'public_share_links_i_published', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'ticket_id', s.ticket_id, 'subject', s.subject,
        'summary', s.summary, 'revoked', s.revoked, 'created_at', s.created_at
      ) order by s.created_at), '[]'::jsonb)
      from ticketing.shared_ticket_summaries s
      where s.published_by = (select auth.uid())
    ),
    'ratings_i_gave', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'ticket_id', r.ticket_id, 'score', r.score, 'comment', r.comment,
        'created_at', r.created_at, 'updated_at', r.updated_at
      ) order by r.created_at), '[]'::jsonb)
      from ticketing.ticket_ratings r
      where r.rated_by = (select auth.uid())
    ),
    'notes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', n.id, 'title', n.title, 'body', n.body,
        'created_at', n.created_at, 'updated_at', n.updated_at
      ) order by n.created_at), '[]'::jsonb)
      from ticketing.notes n
      where n.owner_id = (select auth.uid())
    ),
    'assistant_conversations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', cv.id, 'title', cv.title, 'created_at', cv.created_at,
        'messages', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'role', m.role, 'content', m.content, 'model', m.model,
            'created_at', m.created_at
          ) order by m.created_at), '[]'::jsonb)
          from ticketing.assistant_messages m
          where m.conversation_id = cv.id
        )
      ) order by cv.created_at), '[]'::jsonb)
      from ticketing.assistant_conversations cv
      where cv.owner_id = (select auth.uid())
    )
  );
$$;

revoke execute on function ticketing.export_own_data() from public, anon;
grant execute on function ticketing.export_own_data() to authenticated;
