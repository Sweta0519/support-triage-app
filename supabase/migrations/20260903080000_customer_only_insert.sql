-- Reviewer finding: ticket creation was made customer-only in the Server
-- Action and pages, but the insert policy only checked ownership and the
-- pristine row state -- an agent or admin could still POST /rest/v1/tickets
-- directly and file a ticket for themselves. Enforce the role at the
-- database, where every other boundary in this app is enforced.
drop policy "tickets_insert_customer" on ticketing.tickets;
create policy "tickets_insert_customer" on ticketing.tickets
  for insert
  to authenticated
  with check (
    (select ticketing.app_role()) = 'customer'
    and customer_id = auth.uid()
    and status = 'new'
    and assignee_id is null
    and triage_status = 'pending'
    and priority is null
    and category is null
    and team is null
    and first_response_at is null
    and resolved_at is null
    and closed_at is null
  );
