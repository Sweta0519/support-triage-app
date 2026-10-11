-- SUP-22: account settings -- a display name and preferences each user
-- can change for themselves.
--
-- authenticated still has no UPDATE on profiles (audit S10), so nobody can
-- write their own role or email through the Data API. The one write path
-- is update_own_profile(): SECURITY DEFINER, always the caller's own row
-- (auth.uid(), no id parameter), and it names only these four columns.
-- admin_set_role() stays the only way a role changes.

-- Typed columns rather than a jsonb blob: each has a fixed set of values,
-- and a check constraint states it better than validating json shape.
alter table ticketing.profiles
  add column theme text not null default 'system'
    constraint profiles_theme_check check (theme in ('system', 'light', 'dark')),
  add column queue_default_filter text not null default 'all'
    constraint profiles_queue_default_filter_check
      check (queue_default_filter in ('all', 'unassigned', 'mine')),
  add column queue_default_sort text not null default 'sla'
    constraint profiles_queue_default_sort_check
      check (queue_default_sort in ('sla', 'newest', 'oldest'));

-- Display names were capped at 120 by audit S4's constraint; the settings
-- form allows 80. No profile had a name when this was applied (checked
-- beforehand), and the constraint itself would have failed otherwise.
alter table ticketing.profiles drop constraint profiles_full_name_length;
alter table ticketing.profiles
  add constraint profiles_full_name_length check (full_name is null or char_length(full_name) <= 80);

-- New action 'update_profile', 20 per 10 minutes. Same redefine-the-whole-
-- function pattern as every earlier case addition.
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

-- p_full_name: trimmed; blank clears it (the app then falls back to the
-- email). No control characters -- a name is one line of plain text.
-- Invalid input raises 22023; the column check constraints back up the
-- preference values. A raise rolls back the rate-limit charge too, which
-- is fine here: a refused edit reveals nothing, so there is nothing to
-- probe for free.
create or replace function ticketing.update_own_profile(
  p_full_name text,
  p_theme text,
  p_queue_default_filter text,
  p_queue_default_sort text
)
returns ticketing.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  result ticketing.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  if not ticketing.consume_rate_limit('update_profile') then
    raise exception 'rate_limited:update_profile';
  end if;

  if v_name is not null and (char_length(v_name) > 80 or v_name ~ '[[:cntrl:]]') then
    raise exception 'invalid_full_name' using errcode = '22023';
  end if;

  update ticketing.profiles
  set full_name = v_name,
      theme = p_theme,
      queue_default_filter = p_queue_default_filter,
      queue_default_sort = p_queue_default_sort,
      updated_at = now()
  where id = v_uid
  returning * into result;

  if result.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return result;
end;
$$;

revoke all on function ticketing.update_own_profile(text, text, text, text) from public;
grant execute on function ticketing.update_own_profile(text, text, text, text) to authenticated;

-- The data export now includes the preferences.
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
