-- SUP-81 follow-up: 20261024020000_workspaces.sql added composite
-- (ticket_id, workspace_id) foreign keys next to the old single-column ones.
-- With two relationships between the same tables, PostgREST refuses every
-- embed between them ("more than one relationship was found"), which broke
-- the ticket pages. The composite keys enforce everything the old ones did
-- (workspace_id is NOT NULL, so the check always runs, with the same ON
-- DELETE actions), so the old ones go.

alter table ticketing.ticket_comments drop constraint ticket_comments_ticket_id_fkey;
alter table ticketing.ticket_events drop constraint ticket_events_ticket_id_fkey;
alter table ticketing.triage_results drop constraint triage_results_ticket_id_fkey;
alter table ticketing.triage_results drop constraint triage_results_duplicate_of_fkey;
alter table ticketing.ticket_triage_state drop constraint ticket_triage_state_ticket_id_fkey;
alter table ticketing.ticket_embeddings drop constraint ticket_embeddings_ticket_id_fkey;
alter table ticketing.ticket_labels drop constraint ticket_labels_ticket_id_fkey;
alter table ticketing.ticket_labels drop constraint ticket_labels_label_id_fkey;
alter table ticketing.ticket_flags drop constraint ticket_flags_ticket_id_fkey;
alter table ticketing.ticket_ratings drop constraint ticket_ratings_ticket_id_fkey;
alter table ticketing.shared_ticket_summaries drop constraint shared_ticket_summaries_ticket_id_fkey;
alter table ticketing.incident_tickets drop constraint incident_tickets_ticket_id_fkey;
alter table ticketing.incident_tickets drop constraint incident_tickets_incident_id_fkey;

-- PostgREST caches the schema; make it pick up the change now.
notify pgrst, 'reload schema';
