-- SUP-43 review fixes (20261014000000 is already applied).
--
-- 1. set_learning_excluded() only acts on a real correction (a reviewed
--    ticket), says so when it isn't one, and records the change in the
--    ticket's history.
-- 2. An exclusion belongs to the correction it was made on: a new review of
--    the ticket clears it, so a later, different correction can teach again.
-- 3. learnable_correction_count() gives Analytics the exact number the
--    matcher could use (reviewed, changed, not excluded, embedded), rather
--    than a count over a sample of recent tickets.

create or replace function ticketing.set_learning_excluded(p_ticket_id uuid, p_excluded boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select ticketing.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update ticketing.ticket_triage_state
  set learning_excluded_at = case when p_excluded then now() else null end,
      learning_excluded_by = case when p_excluded then auth.uid() else null end
  where ticket_id = p_ticket_id
    and reviewed_at is not null;
  if not found then
    raise exception 'not_a_correction' using errcode = 'P0002';
  end if;
  insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
  values (p_ticket_id, auth.uid(), case when p_excluded then 'learning_excluded' else 'learning_included' end, null, null);
  return true;
end;
$$;

create or replace function ticketing.clear_learning_exclusion_on_review()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.reviewed_at is distinct from old.reviewed_at then
    new.learning_excluded_at := null;
    new.learning_excluded_by := null;
  end if;
  return new;
end;
$$;

revoke all on function ticketing.clear_learning_exclusion_on_review() from public;

create trigger ticket_triage_state_clear_learning_exclusion
  before update on ticketing.ticket_triage_state
  for each row execute function ticketing.clear_learning_exclusion_on_review();

-- Admins only: how many corrections the AI can currently learn from.
create or replace function ticketing.learnable_correction_count()
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not (select ticketing.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return (
    select count(*)::int
    from ticketing.ticket_triage_state s
    join ticketing.triage_results r on r.id = s.reviewed_result_id
    join ticketing.ticket_embeddings e on e.ticket_id = s.ticket_id
    where s.reviewed_at is not null
      and s.learning_excluded_at is null
      and (r.priority, r.category, r.team) is distinct from (s.priority, s.category, s.team)
  );
end;
$$;

revoke all on function ticketing.learnable_correction_count() from public;
grant execute on function ticketing.learnable_correction_count() to authenticated;
