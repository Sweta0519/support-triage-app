-- SUP-32: make automatic model retries visible, and say why triage failed.
--
-- retry_count: how many automatic retries the run's model calls needed
-- (background triage only; interactive calls and manual re-runs never
-- retry). Sits next to cost_usd so retry cost is visible per run.
-- failure_reason: why the latest run failed, coarse and safe to show staff
-- (no provider error text). Cleared when a new run claims the ticket.

alter table ticketing.triage_results
  add column retry_count smallint not null default 0
    constraint triage_results_retry_count_check check (retry_count >= 0);

alter table ticketing.ticket_triage_state
  add column failure_reason text
    constraint ticket_triage_state_failure_reason_check
      check (failure_reason in ('rate_limited', 'provider_unavailable', 'timeout', 'invalid_response', 'error'));
