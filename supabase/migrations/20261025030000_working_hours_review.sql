-- SUP-85 review fixes (PR #90), on top of 20261025010000_working_hours.sql.
--
-- 1. Equal start and end times are now a 24-hour shift. Before, all day
--    could only be written 00:00-23:59, which put a shift edge at 23:59 and
--    another at 00:00 every night.
-- 2. Signing out sets Offline until the person signs in again, not only
--    until their next shift starts: someone on leave who signed out must
--    not show Online at every shift start. sign_out_presence() stores the
--    pick's time as 'infinity', so it is newer than any shift edge, and
--    resume_presence_after_sign_in() puts it back to null, so the schedule
--    decides again (with no schedule, Offline stays until they pick, as in
--    SUP-76).

alter table ticketing.profiles
  drop constraint profiles_work_hours_check,
  add constraint profiles_work_hours_check check (
    (work_days is null and work_start is null and work_end is null)
    or (
      cardinality(work_days) between 1 and 7
      and work_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
      and work_start is not null
      and work_end is not null
    )
  );

-- As in 20261025010000_working_hours.sql, without the start <> end check.
create or replace function ticketing.admin_set_workload(
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

-- Sign-out's Offline. Like set_own_presence(): the caller's own row, staff
-- only (42501), rate-limited under the same 'set_presence' action.
create or replace function ticketing.sign_out_presence()
returns void
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

  if not ticketing.consume_rate_limit('set_presence') then
    raise exception 'rate_limited:set_presence';
  end if;

  update ticketing.profiles
  set presence = 'offline',
      presence_set_at = 'infinity'
  where id = v_uid;
end;
$$;

revoke all on function ticketing.sign_out_presence() from public;
grant execute on function ticketing.sign_out_presence() to authenticated;

-- Called after a sign-in. Only ever clears the caller's own sign-out hold,
-- so it needs no role check or rate limit: for anyone else it changes
-- nothing.
create or replace function ticketing.resume_presence_after_sign_in()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update ticketing.profiles
  set presence_set_at = null
  where id = auth.uid()
    and presence_set_at = 'infinity';
end;
$$;

revoke all on function ticketing.resume_presence_after_sign_in() from public;
grant execute on function ticketing.resume_presence_after_sign_in() to authenticated;
