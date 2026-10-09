-- review_triage() only rejected a save when a newer AI run had landed. It
-- didn't notice another staff member reviewing the ticket after this page
-- loaded, so agent B clicking "Confirm" on an old page silently undid agent
-- A's correction. p_reviewed_at is the reviewed_at the reviewer was shown
-- (null when unreviewed); a mismatch raises 'stale_review' (default P0001).
--
-- The signature changes, so the old function is dropped rather than left
-- callable without the check.
drop function ticketing.review_triage(
  uuid, uuid, ticketing.ticket_priority, ticketing.ticket_category, ticketing.ticket_team
);

create or replace function ticketing.review_triage(
  p_ticket_id uuid,
  p_result_id uuid,
  p_priority ticketing.ticket_priority,
  p_category ticketing.ticket_category,
  p_team ticketing.ticket_team,
  p_reviewed_at timestamptz
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
    raise exception 'stale_triage';
  end if;

  select * into v_old
  from ticketing.ticket_triage_state
  where ticket_id = p_ticket_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Checked under the row lock, so two reviewers can't both pass it.
  if v_old.reviewed_at is distinct from p_reviewed_at then
    raise exception 'stale_review';
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
  uuid, uuid, ticketing.ticket_priority, ticketing.ticket_category, ticketing.ticket_team, timestamptz
) from public;
grant execute on function ticketing.review_triage(
  uuid, uuid, ticketing.ticket_priority, ticketing.ticket_category, ticketing.ticket_team, timestamptz
) to authenticated;
