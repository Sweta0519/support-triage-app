-- SUP-83 (workspaces, part 3): rate limits per workspace.
--
-- Every limit so far is per person. A workspace with many accounts could
-- still spend as many model calls as it has people, so the actions that
-- cost AI calls now also count against a workspace-wide budget:
--
--   create_ticket, staff_create_ticket  triage (two model calls + embedding)
--   rerun_triage                        the same, again
--   assistant_message                   Sage
--   save_note                           embeddings for a staff note
--   mcp_request                         any of the above through /api/mcp
--
-- The workspace is counted only once the person's own limit has passed,
-- so one person who is over their limit can't use up their teammates'
-- budget by retrying. Keys are 'ws:<workspace_id>:<action>', next to the
-- per-person '<uid>:<action>' keys. A caller with no membership row (no
-- profile yet) is limited per person only, as before.

create or replace function ticketing.consume_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_window_seconds int;
  v_ws_limit int;
  v_key text;
  v_window_start timestamptz;
  v_count int;
  v_ws uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  case p_action
    when 'create_ticket' then v_limit := 10; v_window_seconds := 3600; v_ws_limit := 200;
    when 'staff_create_ticket' then v_limit := 30; v_window_seconds := 3600; v_ws_limit := 300;
    when 'add_comment'   then v_limit := 30; v_window_seconds := 600;
    when 'rerun_triage'  then v_limit := 5;  v_window_seconds := 600; v_ws_limit := 50;
    when 'assistant_message' then v_limit := 20; v_window_seconds := 600; v_ws_limit := 200;
    when 'save_note'     then v_limit := 30; v_window_seconds := 600; v_ws_limit := 200;
    when 'rate_ticket'   then v_limit := 10; v_window_seconds := 600;
    when 'update_profile' then v_limit := 20; v_window_seconds := 600;
    when 'update_avatar' then v_limit := 10; v_window_seconds := 600;
    when 'access_token'  then v_limit := 10; v_window_seconds := 3600;
    when 'mcp_request'   then v_limit := 120; v_window_seconds := 600; v_ws_limit := 1000;
    when 'set_presence'  then v_limit := 60; v_window_seconds := 600;
    when 'workspace_invite' then v_limit := 20; v_window_seconds := 3600;
    when 'workspace_join_rotate' then v_limit := 10; v_window_seconds := 3600;
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

  if v_count > v_limit then
    return false;
  end if;

  if v_ws_limit is not null then
    select m.workspace_id into v_ws from ticketing.workspace_members m where m.user_id = auth.uid();
    if v_ws is not null then
      insert into ticketing.rate_limits (key, window_start, count)
      values ('ws:' || v_ws::text || ':' || p_action, v_window_start, 1)
      on conflict (key, window_start)
        do update set count = ticketing.rate_limits.count + 1
      returning count into v_count;
      return v_count <= v_ws_limit;
    end if;
  end if;

  return true;
end;
$$;
