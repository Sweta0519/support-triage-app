-- SUP-94 review: webhook_events' ticket_id and workspace_id were plain foreign
-- keys. Use the same composite foreign key as the other ticket child tables
-- (see 20261024020000_workspaces.sql), so a row's workspace must be its
-- ticket's. The workspace foreign key stays, as on those tables.
alter table ticketing.webhook_events drop constraint if exists webhook_events_ticket_id_fkey;

alter table ticketing.webhook_events
  add constraint webhook_events_ticket_workspace_fkey
  foreign key (ticket_id, workspace_id) references ticketing.tickets (id, workspace_id) on delete cascade;
