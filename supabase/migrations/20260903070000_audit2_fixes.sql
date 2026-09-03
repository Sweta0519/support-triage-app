-- Fixes from security audit #2 (docs/security/audit-2-fresh-context-rescan.md).
-- W# / S# tags reference findings in that report.

-- W2: INSERT is now column-level, the same way UPDATE already is. A client can
-- only ever supply the columns a real submission needs; created_at,
-- first_response_at, resolved_at, closed_at, id, status, triage_status and
-- the triage fields take their defaults. The policy also pins the three
-- timestamps to null as belt-and-braces.
revoke insert on ticketing.tickets from authenticated;
grant insert (customer_id, subject, body) on ticketing.tickets to authenticated;

revoke insert on ticketing.ticket_comments from authenticated;
grant insert (ticket_id, author_id, body, is_internal) on ticketing.ticket_comments to authenticated;

drop policy "tickets_insert_customer" on ticketing.tickets;
create policy "tickets_insert_customer" on ticketing.tickets
  for insert
  to authenticated
  with check (
    customer_id = auth.uid()
    and status = 'new'
    and assignee_id is null
    and triage_status = 'pending'
    and priority is null
    and category is null
    and team is null
    and first_response_at is null
    and resolved_at is null
    and closed_at is null
  );

-- S1: `alter default privileges` only affects functions created afterwards.
-- Make the privileges of the existing callable functions explicit: only
-- `authenticated` (policies and triggers run as the caller) and
-- `service_role` may execute them.
revoke execute on function ticketing.app_role() from public;
revoke execute on function ticketing.is_staff() from public;
revoke execute on function ticketing.is_admin() from public;
revoke execute on function ticketing.can_view_ticket(uuid) from public;
revoke execute on function ticketing.ensure_profile() from public;
revoke execute on function ticketing.admin_set_role(uuid, ticketing.app_role) from public;
revoke execute on function ticketing.consume_rate_limit(text, int, int) from public;

grant execute on function ticketing.app_role() to authenticated, service_role;
grant execute on function ticketing.is_staff() to authenticated, service_role;
grant execute on function ticketing.is_admin() to authenticated, service_role;
grant execute on function ticketing.can_view_ticket(uuid) to authenticated, service_role;
grant execute on function ticketing.ensure_profile() to authenticated;
grant execute on function ticketing.admin_set_role(uuid, ticketing.app_role) to authenticated;
grant execute on function ticketing.consume_rate_limit(text, int, int) to authenticated, service_role;

-- S2: the action label is a closed set, so an authenticated caller can't
-- grow rate_limits with arbitrary keys or window sizes.
create or replace function ticketing.consume_rate_limit(
  p_action text,
  p_limit int,
  p_window_seconds int
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_window_start timestamptz;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_action not in ('create_ticket', 'add_comment', 'rerun_triage') then
    raise exception 'unknown rate limit action';
  end if;
  if p_window_seconds <= 0 or p_window_seconds > 86400 or p_limit <= 0 then
    raise exception 'invalid rate limit parameters';
  end if;

  v_key := auth.uid()::text || ':' || p_action;
  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into ticketing.rate_limits (key, window_start, count)
  values (v_key, v_window_start, 1)
  on conflict (key, window_start)
    do update set count = ticketing.rate_limits.count + 1
  returning count into v_count;

  if random() < 0.01 then
    delete from ticketing.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

-- S3: auth.users is shared with another app. A signup without an email
-- (phone / anonymous, if ever enabled) must not fail this trigger and take
-- the other app's signup down with it. Such users simply get no ticketing
-- profile; ensure_profile() then reports it clearly.
create or replace function ticketing.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null then
    return new;
  end if;

  insert into ticketing.profiles (id, email, role)
  values (new.id, new.email, 'customer')
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function ticketing.ensure_profile()
returns ticketing.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  result ticketing.profiles;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select u.email into v_email from auth.users u where u.id = auth.uid();
  if v_email is null then
    raise exception 'an email address is required to use this app';
  end if;

  insert into ticketing.profiles (id, email, role)
  values (auth.uid(), v_email, 'customer')
  on conflict (id) do nothing;

  select * into result from ticketing.profiles where id = auth.uid();
  return result;
end;
$$;
