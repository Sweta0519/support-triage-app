-- SUP-76: staff presence -- Online / Away / Offline, picked by each agent
-- or admin from the dropdown under their name in the sidebar.
--
-- It's a label staff show each other, nothing more: it never changes
-- assignment or ticket status. Customers never see it.
--
-- authenticated still has no UPDATE on profiles (audit S10). The one write
-- path is set_own_presence(): SECURITY DEFINER, always the caller's own row
-- (auth.uid(), no id parameter), staff only, and it names only this column.

alter table ticketing.profiles
  add column presence text not null default 'online'
    constraint profiles_presence_check check (presence in ('online', 'away', 'offline'));

-- New action 'set_presence', 60 per 10 minutes: generous for clicking
-- around, but a script can't hammer the profiles row. The rest is as in
-- 20261015030000_mcp_rate_limit.sql.
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
    when 'access_token'  then v_limit := 10; v_window_seconds := 3600;
    when 'mcp_request'   then v_limit := 120; v_window_seconds := 600;
    when 'set_presence'  then v_limit := 60; v_window_seconds := 600;
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

-- Invalid input raises 22023 (the check constraint backs it up); a
-- customer, or a session whose profile vanished, gets 42501.
create or replace function ticketing.set_own_presence(p_presence text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not ticketing.is_staff() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_presence is null or p_presence not in ('online', 'away', 'offline') then
    raise exception 'invalid_presence' using errcode = '22023';
  end if;

  if not ticketing.consume_rate_limit('set_presence') then
    raise exception 'rate_limited:set_presence';
  end if;

  -- updated_at is left alone: it dates profile edits, and presence flips
  -- many times a day.
  update ticketing.profiles
  set presence = p_presence
  where id = v_uid;

  return p_presence;
end;
$$;

revoke all on function ticketing.set_own_presence(text) from public;
grant execute on function ticketing.set_own_presence(text) to authenticated;
