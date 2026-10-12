-- SUP-30 review (PR #38): each triage claim gets an id and a time.
--
--  * claim_id: the run that currently owns the ticket's triage. Its final
--    writes (the applied fields, "completed"/"failed") only apply while the
--    claim is still theirs, so a run that was slow rather than dead can't
--    overwrite the re-run that replaced it.
--  * claimed_at: when that run started. Stall detection uses it rather than
--    updated_at, which any write bumps (a staff review would otherwise make
--    a stuck run look fresh).
-- The service role is the only writer of this table, so no grants change.

alter table ticketing.ticket_triage_state
  add column claim_id uuid,
  add column claimed_at timestamptz;

-- Runs already in flight: their start time is the claim's updated_at.
update ticketing.ticket_triage_state
set claimed_at = updated_at
where triage_status = 'processing';
