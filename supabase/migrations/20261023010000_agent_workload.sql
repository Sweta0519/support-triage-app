-- SUP-77: Admin > Workload -- a daily cap on the new cases each agent (or
-- admin) can be given, and the timezone of their workplace, which says when
-- their day starts.
--
-- "New cases today" = distinct tickets that became theirs since local
-- midnight in their timezone, read from the assignee_changed events that
-- guard_ticket_update() already records. A ticket counts once per day: one
-- unassigned and given back the same day doesn't count again.
--
-- The cap is enforced here, in a trigger on tickets, so every path obeys
-- it: the queue's Claim, card menu and board moves, the ticket page's Claim
-- and Reassign, and the MCP claim_ticket tool. A null cap means no cap.
--
-- Both settings are written only through admin_set_workload() (admins
-- only); authenticated still has no UPDATE on profiles.

alter table ticketing.profiles
  add column daily_case_cap int
    constraint profiles_daily_case_cap_check check (daily_case_cap is null or daily_case_cap between 0 and 200),
  -- An IANA name (e.g. Europe/Berlin). Checked against pg_timezone_names by
  -- admin_set_workload(); a check constraint can't read that view.
  add column timezone text not null default 'UTC';

-- The count below reads one person's assignments in a time range.
create index ticket_events_assigned_to_idx
  on ticketing.ticket_events (to_value, created_at)
  where event_type = 'assignee_changed';

-- When "today" began for this person: local midnight in their timezone.
create or replace function ticketing.workday_start(p_staff uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (date_trunc('day', now() at time zone p.timezone) at time zone p.timezone)
  from ticketing.profiles p
  where p.id = p_staff;
$$;

revoke all on function ticketing.workday_start(uuid) from public;

-- Not STABLE on purpose: called after the cap trigger takes its lock, it
-- must see assignments committed while it waited, so it takes a fresh
-- snapshot rather than its caller's.
create or replace function ticketing.cases_assigned_today(p_staff uuid)
returns int
language sql
security definer
set search_path = ''
as $$
  select count(distinct e.ticket_id)::int
  from ticketing.ticket_events e
  where e.event_type = 'assignee_changed'
    and e.to_value = p_staff::text
    and e.created_at >= ticketing.workday_start(p_staff);
$$;

revoke all on function ticketing.cases_assigned_today(uuid) from public;

-- Refuses a new assignee who already has their cap of new cases today.
-- A per-person advisory lock, held to the end of the transaction, makes
-- two claims at once queue up: the second counts the first's assignment
-- (recorded by guard_ticket_update(), which fires after this trigger --
-- triggers run in name order) instead of both slipping under the cap.
create or replace function ticketing.enforce_daily_case_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap int;
begin
  if new.assignee_id is null or new.assignee_id is not distinct from old.assignee_id then
    return new;
  end if;

  select daily_case_cap into v_cap from ticketing.profiles where id = new.assignee_id;
  if v_cap is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('daily_case_cap:' || new.assignee_id::text, 0));

  -- Already theirs once today: given back, not a new case.
  if exists (
    select 1 from ticketing.ticket_events e
    where e.ticket_id = new.id
      and e.event_type = 'assignee_changed'
      and e.to_value = new.assignee_id::text
      and e.created_at >= ticketing.workday_start(new.assignee_id)
  ) then
    return new;
  end if;

  if ticketing.cases_assigned_today(new.assignee_id) >= v_cap then
    raise exception 'daily_case_cap_reached' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function ticketing.enforce_daily_case_cap() from public;

-- "tickets_daily_case_cap" sorts before "tickets_guard_update", so this
-- runs first (see the lock comment above).
create trigger tickets_daily_case_cap
  before update of assignee_id on ticketing.tickets
  for each row execute function ticketing.enforce_daily_case_cap();

-- The Workload page: every agent and admin, with today's count. Admins
-- only (42501 otherwise).
create or replace function ticketing.admin_workload()
returns table (
  id uuid,
  email text,
  full_name text,
  avatar_path text,
  role ticketing.app_role,
  presence text,
  daily_case_cap int,
  timezone text,
  assigned_today int
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  return query
    select p.id, p.email, p.full_name, p.avatar_path, p.role, p.presence,
           p.daily_case_cap, p.timezone, ticketing.cases_assigned_today(p.id)
    from ticketing.profiles p
    where p.role in ('agent', 'admin');
end;
$$;

revoke all on function ticketing.admin_workload() from public;
grant execute on function ticketing.admin_workload() to authenticated;

-- p_cap null = no cap. Invalid input raises 22023; a non-admin caller
-- 42501; a target who isn't (or is no longer) staff P0002.
create or replace function ticketing.admin_set_workload(p_target uuid, p_cap int, p_timezone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ticketing.is_admin() then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_cap is not null and (p_cap < 0 or p_cap > 200) then
    raise exception 'invalid_cap' using errcode = '22023';
  end if;

  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;

  update ticketing.profiles
  set daily_case_cap = p_cap,
      timezone = p_timezone,
      updated_at = now()
  where id = p_target and role in ('agent', 'admin');

  if not found then
    raise exception 'not_staff' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function ticketing.admin_set_workload(uuid, int, text) from public;
grant execute on function ticketing.admin_set_workload(uuid, int, text) to authenticated;
