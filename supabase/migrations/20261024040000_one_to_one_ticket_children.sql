-- SUP-81 follow-up: PostgREST treats a foreign key as one-to-one only when
-- its columns are the child's primary key or a unique key. The old
-- ticket_id keys were (ticket_id is the primary key or unique on these
-- tables), so `triage_state:ticket_triage_state(...)` came back as an object.
-- The composite (ticket_id, workspace_id) keys that replaced them aren't, so
-- those embeds started coming back as arrays and the triage panel, queue
-- signals and SLA reads all saw nothing. A matching unique key restores
-- one-to-one; it adds no new rule, since ticket_id alone is already unique.

alter table ticketing.ticket_triage_state
  add constraint ticket_triage_state_ticket_workspace_key unique (ticket_id, workspace_id);
alter table ticketing.ticket_embeddings
  add constraint ticket_embeddings_ticket_workspace_key unique (ticket_id, workspace_id);
alter table ticketing.ticket_ratings
  add constraint ticket_ratings_ticket_workspace_key unique (ticket_id, workspace_id);
alter table ticketing.incident_tickets
  add constraint incident_tickets_ticket_workspace_key unique (ticket_id, workspace_id);

notify pgrst, 'reload schema';
