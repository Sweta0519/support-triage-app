-- SUP-85: working hours on Admin > Workload. An admin sets the days and the
-- start and end time of each agent's (or admin's) shift, in their workplace
-- timezone (SUP-77). Their status then shows Online during the shift and
-- Offline outside it, by itself.
--
-- Nothing runs on a timer. profiles.presence stays the person's last pick
-- from the sidebar dropdown, and presence_set_at says when they made it.
-- The status shown is worked out when it is read (app/lib/work-hours.ts):
-- a pick made since the latest shift start or end holds; otherwise the
-- schedule decides. So picking Away mid-shift lasts until the shift ends,
-- and signing out (Offline) lasts until the next shift starts.
--
-- Like presence, it's a label staff show each other: it never assigns
-- tickets or changes their status.
--
-- The hours are written only through admin_set_workload() (admins only);
-- authenticated still has no UPDATE on profiles.

alter table ticketing.profiles
  -- ISO weekdays, 1 = Monday .. 7 = Sunday. Null = no schedule.
  add column work_days smallint[],
  add column work_start time,
  -- Earlier than work_start = the shift ends the next day (a night shift).
  add column work_end time,
  add column presence_set_at timestamptz,
  add constraint profiles_work_hours_check check (
    (work_days is null and work_start is null and work_end is null)
    or (
      cardinality(work_days) between 1 and 7
      and work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      and work_start is not null
      and work_end is not null
      and work_start <> work_end
    )
  );

-- As in 20261023000000_staff_presence.sql, plus the time of the pick.
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
  set presence = p_presence,
      presence_set_at = now()
  where id = v_uid;

  return p_presence;
end;
$$;

-- The return type changes, so drop and recreate. As in
-- 20261024020000_workspaces.sql, plus the hours and presence_set_at.
drop function ticketing.admin_workload();

create function ticketing.admin_workload()
returns table (
  id uuid,
  email text,
  full_name text,
  avatar_path text,
  role ticketing.app_role,
  presence text,
  presence_set_at timestamptz,
  daily_case_cap integer,
  timezone text,
  work_days smallint[],
  work_start time,
  work_end time,
  assigned_today integer
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
    select p.id, p.email, p.full_name, p.avatar_path, m.role, p.presence, p.presence_set_at,
           p.daily_case_cap, p.timezone, p.work_days, p.work_start, p.work_end,
           ticketing.cases_assigned_today(p.id)
    from ticketing.profiles p
    join ticketing.workspace_members m on m.user_id = p.id
    where m.workspace_id = ticketing.current_workspace_id()
      and m.role in ('agent', 'admin');
end;
$$;

revoke all on function ticketing.admin_workload() from public;
grant execute on function ticketing.admin_workload() to authenticated;

-- One Save on the row writes all of it, so the hours join the old
-- arguments instead of getting a function of their own. The old
-- three-argument admin_set_workload() stays for now: the deployed build
-- still calls it until this change ships, and it leaves the hours alone.
-- A later migration drops it.

-- p_cap null = no cap; p_work_days, p_work_start and p_work_end all null =
-- no schedule. Invalid input raises 22023; a non-admin caller 42501; a
-- target who isn't (or is no longer) staff in the caller's workspace P0002.
create function ticketing.admin_set_workload(
  p_target uuid,
  p_cap integer,
  p_timezone text,
  p_work_days smallint[],
  p_work_start time,
  p_work_end time
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days smallint[];
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

  if p_work_days is not null or p_work_start is not null or p_work_end is not null then
    if p_work_days is null or p_work_start is null or p_work_end is null
       or cardinality(p_work_days) = 0
       or not (p_work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
       or p_work_start = p_work_end
    then
      raise exception 'invalid_work_hours' using errcode = '22023';
    end if;
    -- Stored sorted and without repeats.
    select array_agg(distinct d order by d) into v_days from unnest(p_work_days) d;
  end if;

  update ticketing.profiles p
  set daily_case_cap = p_cap,
      timezone = p_timezone,
      work_days = v_days,
      work_start = p_work_start,
      work_end = p_work_end,
      updated_at = now()
  from ticketing.workspace_members m
  where p.id = p_target
    and m.user_id = p.id
    and m.workspace_id = ticketing.current_workspace_id()
    and m.role in ('agent', 'admin');

  if not found then
    raise exception 'not_staff' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function ticketing.admin_set_workload(uuid, integer, text, smallint[], time, time) from public;
grant execute on function ticketing.admin_set_workload(uuid, integer, text, smallint[], time, time) to authenticated;
