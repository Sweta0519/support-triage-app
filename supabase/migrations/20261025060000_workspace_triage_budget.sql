-- SUP-83 review (PR #93): the workspace budget gates AI triage, not filing.
--
-- 20261025040000 refused create_ticket, staff_create_ticket and
-- mcp_request once a workspace's budget was spent. Customers sign
-- themselves up (the default workspace through "Get in touch", any other
-- through its join link), so about 20 throwaway accounts could stop every
-- real customer in a workspace filing tickets for an hour, and about 9 MCP
-- tokens could lock its staff out of MCP. Now:
--
--   * Filing a ticket and MCP requests are limited per person only, as
--     before 040000. An MCP request isn't AI spend by itself; the calls it
--     makes count under their own actions.
--   * Each triage run (new ticket, re-run, or a ticket filed at sign-in)
--     spends one unit of its workspace's triage budget, 200 an hour,
--     checked before any model call by consume_triage_budget(). Over it,
--     the ticket is still filed: its triage fails with reason 'budget' and
--     staff can re-run it later.
--   * The staff-only AI actions (rerun_triage, assistant_message,
--     save_note) keep their workspace caps. Staff join by admin invite.
--   * When the workspace refuses, the person's own count is given back, so
--     a refused call doesn't use up their own limit either.

-- One counter bump: returns the window's count after this call.
create function ticketing.bump_rate_limit(p_key text, p_window_start timestamptz)
returns int
language sql
set search_path = ''
as $$
  insert into ticketing.rate_limits (key, window_start, count)
  values (p_key, p_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count;
$$;
revoke all on function ticketing.bump_rate_limit(text, timestamptz) from public, anon, authenticated;

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
  v_ws uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  case p_action
    when 'create_ticket' then v_limit := 10; v_window_seconds := 3600;
    when 'staff_create_ticket' then v_limit := 30; v_window_seconds := 3600;
    when 'add_comment'   then v_limit := 30; v_window_seconds := 600;
    when 'rerun_triage'  then v_limit := 5;  v_window_seconds := 600; v_ws_limit := 50;
    when 'assistant_message' then v_limit := 20; v_window_seconds := 600; v_ws_limit := 200;
    when 'save_note'     then v_limit := 30; v_window_seconds := 600; v_ws_limit := 200;
    when 'rate_ticket'   then v_limit := 10; v_window_seconds := 600;
    when 'update_profile' then v_limit := 20; v_window_seconds := 600;
    when 'update_avatar' then v_limit := 10; v_window_seconds := 600;
    when 'access_token'  then v_limit := 10; v_window_seconds := 3600;
    when 'mcp_request'   then v_limit := 120; v_window_seconds := 600;
    when 'set_presence'  then v_limit := 60; v_window_seconds := 600;
    when 'workspace_invite' then v_limit := 20; v_window_seconds := 3600;
    when 'workspace_join_rotate' then v_limit := 10; v_window_seconds := 3600;
    else raise exception 'unknown rate limit action';
  end case;

  v_key := auth.uid()::text || ':' || p_action;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / v_window_seconds) * v_window_seconds
  );

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  if ticketing.bump_rate_limit(v_key, v_window_start) > v_limit then
    return false;
  end if;

  if v_ws_limit is not null then
    select m.workspace_id into v_ws from ticketing.workspace_members m where m.user_id = auth.uid();
    if v_ws is not null
       and ticketing.bump_rate_limit('ws:' || v_ws::text || ':' || p_action, v_window_start) > v_ws_limit then
      update ticketing.rate_limits set count = count - 1
      where key = v_key and window_start = v_window_start;
      return false;
    end if;
  end if;

  return true;
end;
$$;

-- The triage pipeline runs with the service role (no auth.uid()), so it
-- names the ticket and the workspace is taken from it here.
create function ticketing.consume_triage_budget(p_ticket_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws uuid;
begin
  select t.workspace_id into v_ws from ticketing.tickets t where t.id = p_ticket_id;
  if v_ws is null then
    return false;
  end if;
  return ticketing.bump_rate_limit(
    'ws:' || v_ws::text || ':triage',
    to_timestamp(floor(extract(epoch from now()) / 3600) * 3600)
  ) <= 200;
end;
$$;
revoke all on function ticketing.consume_triage_budget(uuid) from public, anon, authenticated;
grant execute on function ticketing.consume_triage_budget(uuid) to service_role;

alter table ticketing.ticket_triage_state drop constraint ticket_triage_state_failure_reason_check;
alter table ticketing.ticket_triage_state add constraint ticket_triage_state_failure_reason_check
  check (failure_reason in ('rate_limited', 'provider_unavailable', 'timeout', 'invalid_response', 'error', 'budget'));
