-- SUP-36: the staff "AI triage is off / failing" banner reads the latest
-- triage runs (by claimed_at) on every staff page load. A partial index
-- keeps that a short index scan however many tickets there are.
create index if not exists ticket_triage_state_recent_runs_idx
  on ticketing.ticket_triage_state (claimed_at desc)
  where triage_status in ('completed', 'failed', 'processing') and claimed_at is not null;
