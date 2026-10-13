-- SUP-32 review: failure_reason describes the latest *failed* run, so it
-- must be null whenever the state isn't failed. Enforced here rather than
-- by every writer remembering: resetTriageStatus() (manual re-run) moves a
-- failed row to pending, and the claim moves it to processing.

create or replace function ticketing.clear_triage_failure_reason()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.triage_status is distinct from 'failed' then
    new.failure_reason := null;
  end if;
  return new;
end;
$$;

revoke all on function ticketing.clear_triage_failure_reason() from public;

create trigger ticket_triage_state_clear_failure_reason
  before insert or update on ticketing.ticket_triage_state
  for each row execute function ticketing.clear_triage_failure_reason();

-- Existing rows: none should violate it, but make sure.
update ticketing.ticket_triage_state set failure_reason = null
where triage_status is distinct from 'failed' and failure_reason is not null;
