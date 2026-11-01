-- SUP-96: webhook_events also logs the incident.opened alert. A row is about
-- either a ticket (escalation) or an incident, never both, and each incident
-- gets one incident.opened row (plain UNIQUE, not a partial index, because
-- PostgREST's on_conflict sends no predicate).
alter table ticketing.webhook_events alter column ticket_id drop not null;
alter table ticketing.webhook_events add column incident_id uuid;

alter table ticketing.webhook_events
  add constraint webhook_events_incident_workspace_fkey
  foreign key (incident_id, workspace_id) references ticketing.incidents (id, workspace_id) on delete cascade;

alter table ticketing.webhook_events drop constraint webhook_events_event_type_check;
alter table ticketing.webhook_events add constraint webhook_events_event_subject_check check (
  (event_type = 'ticket.escalation_flagged' and ticket_id is not null and incident_id is null)
  or (event_type = 'incident.opened' and incident_id is not null and ticket_id is null)
);

-- incident_id first, so it also serves the FK cascade lookup.
alter table ticketing.webhook_events
  add constraint webhook_events_incident_event_key unique (incident_id, event_type);

-- The workspace comes from the row's ticket or incident, never the client.
-- set_workspace_from_ticket() is shared by 10 tables and stays as it is.
create function ticketing.set_webhook_event_workspace()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.incident_id is not null then
    select i.workspace_id into new.workspace_id from ticketing.incidents i where i.id = new.incident_id;
  else
    select t.workspace_id into new.workspace_id from ticketing.tickets t where t.id = new.ticket_id;
  end if;
  return new;
end;
$$;
revoke all on function ticketing.set_webhook_event_workspace() from public;

drop trigger webhook_events_000_set_workspace on ticketing.webhook_events;
create trigger webhook_events_000_set_workspace
  before insert or update of ticket_id, incident_id, workspace_id
  on ticketing.webhook_events for each row execute function ticketing.set_webhook_event_workspace();
