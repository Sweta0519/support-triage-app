-- SUP-77, PR #85 review fixes for the daily case cap.
--
-- 1. The trigger's name now states its order. Triggers on the same event
--    fire in name order, and this one must run before tickets_guard_update,
--    which records the assignee_changed event the next claim counts. The
--    "00" keeps it first even if another trigger is added later.
-- 2. The cap is read again after the advisory lock. Otherwise a claim that
--    waited on the lock while an admin changed the cap was checked against
--    the old one. The first read stays, so an uncapped person never takes
--    the lock at all.

alter trigger tickets_daily_case_cap on ticketing.tickets rename to tickets_00_daily_case_cap;

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

  -- The cap as it is now that it's our turn.
  select daily_case_cap into v_cap from ticketing.profiles where id = new.assignee_id;
  if v_cap is null then
    return new;
  end if;

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
