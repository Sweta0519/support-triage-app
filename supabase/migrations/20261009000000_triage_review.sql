-- Staff review of AI triage: an agent or admin confirms or corrects the
-- AI's priority / category / team. Until now only the service role could
-- write ticket_triage_state, so the AI's suggestion was final and there was
-- no record of whether staff agreed with it. This is what makes triage
-- quality measurable (AI said X in triage_results -> staff set Y here).

-- Who reviewed, when, and *which* AI run they were looking at. A later
-- re-run appends a new triage_results row but must not overwrite a human
-- decision (applyTriageToTicket() skips reviewed rows), so the comparison
-- is always against the run the reviewer actually saw.
alter table ticketing.ticket_triage_state
  add column reviewed_by uuid references auth.users (id) on delete set null,
  add column reviewed_at timestamptz,
  add column reviewed_result_id uuid references ticketing.triage_results (id) on delete set null;

-- The only write path for staff. SECURITY DEFINER because authenticated has
-- no write grant on ticket_triage_state or ticket_events; granting one would
-- let staff change priority through the Data API without leaving an event.
--
-- Visibility is checked explicitly: ticketing.can_view_ticket() is SECURITY
-- INVOKER and relies on RLS, which a definer function bypasses, so calling
-- it here would always return true. The check below mirrors the staff half
-- of the tickets_select policy -- keep the two in sync.
--
-- p_result_id must be the ticket's latest triage run (or null when there is
-- none), so a stale page can't record agreement with a suggestion that has
-- since been replaced.
create or replace function ticketing.review_triage(
  p_ticket_id uuid,
  p_result_id uuid,
  p_priority ticketing.ticket_priority,
  p_category ticketing.ticket_category,
  p_team ticketing.ticket_team
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_old ticketing.ticket_triage_state%rowtype;
  v_ai ticketing.triage_results%rowtype;
  v_latest uuid;
  v_outcome text;
begin
  if v_uid is null or not (select ticketing.is_staff()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_priority is null or p_category is null or p_team is null then
    raise exception 'priority, category and team are all required' using errcode = '22004';
  end if;

  if not exists (
    select 1 from ticketing.tickets t
    where t.id = p_ticket_id
      and (
        (select ticketing.is_admin())
        or t.assignee_id = v_uid
        or t.assignee_id is null
      )
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  select id into v_latest
  from ticketing.triage_results
  where ticket_id = p_ticket_id
  order by created_at desc
  limit 1;

  if p_result_id is distinct from v_latest then
    raise exception 'stale_triage' using errcode = '40001';
  end if;

  select * into v_old
  from ticketing.ticket_triage_state
  where ticket_id = p_ticket_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_latest is null then
    v_outcome := 'manual';
  else
    select * into v_ai from ticketing.triage_results where id = v_latest;
    v_outcome := case
      when v_ai.priority = p_priority and v_ai.category = p_category and v_ai.team = p_team
        then 'confirmed'
      else 'corrected'
    end;
  end if;

  update ticketing.ticket_triage_state
  set priority = p_priority,
      category = p_category,
      team = p_team,
      reviewed_by = v_uid,
      reviewed_at = now(),
      reviewed_result_id = v_latest
  where ticket_id = p_ticket_id;

  if p_priority is distinct from v_old.priority then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (p_ticket_id, v_uid, 'priority_changed', v_old.priority::text, p_priority::text);
  end if;
  if p_category is distinct from v_old.category then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (p_ticket_id, v_uid, 'category_changed', v_old.category::text, p_category::text);
  end if;
  if p_team is distinct from v_old.team then
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (p_ticket_id, v_uid, 'team_changed', v_old.team::text, p_team::text);
  end if;

  insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
  values (p_ticket_id, v_uid, 'triage_reviewed', null, v_outcome);

  return v_outcome;
end;
$$;

revoke all on function ticketing.review_triage(
  uuid, uuid, ticketing.ticket_priority, ticketing.ticket_category, ticketing.ticket_team
) from public;
grant execute on function ticketing.review_triage(
  uuid, uuid, ticketing.ticket_priority, ticketing.ticket_category, ticketing.ticket_team
) to authenticated;
