-- SUP-77, PR #85 code review: the daily cap also covers a ticket that is
-- assigned as it's created. staff_create_ticket(p_assign_to_me => true)
-- inserts the ticket already assigned to the caller, so a trigger that ran
-- only on UPDATE OF assignee_id let an agent at their cap keep giving
-- themselves new cases from the New ticket form.
--
-- The same function serves both triggers: on INSERT, OLD is null, so any
-- assignee counts as a new one. staff_create_ticket() records the
-- assignee_changed event after the insert, in the same transaction, and the
-- advisory lock is held to commit, so the next claim still counts it.
-- "00" keeps it ahead of any other insert trigger, like the update one.

create trigger tickets_00_daily_case_cap_insert
  before insert on ticketing.tickets
  for each row
  when (new.assignee_id is not null)
  execute function ticketing.enforce_daily_case_cap();
