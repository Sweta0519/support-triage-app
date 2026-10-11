-- A short, human-readable ticket number (#1042) to show alongside the UUID:
-- easier to say on a call or quote in a reply than a UUID, which stays the
-- primary key and the id in every URL.
--
-- Existing tickets are numbered by age, starting at 1001, so the order of
-- numbers matches the order tickets came in. New tickets take the next
-- value from the sequence.
--
-- Clients can't set or change it: authenticated only has column-level
-- INSERT (customer_id, subject, body) and UPDATE (status, assignee_id,
-- priority, category, team) on tickets, so the default always applies.

alter table ticketing.tickets add column number bigint;

-- Backfill without firing the user triggers on tickets (updated_at stamps,
-- the update guard): numbering isn't an edit to the ticket.
alter table ticketing.tickets disable trigger user;

update ticketing.tickets t
set number = 1000 + n.rn
from (
  select id, row_number() over (order by created_at, id) as rn
  from ticketing.tickets
) n
where n.id = t.id;

alter table ticketing.tickets enable trigger user;

create sequence ticketing.tickets_number_seq as bigint owned by ticketing.tickets.number;
select setval(
  'ticketing.tickets_number_seq',
  coalesce((select max(number) from ticketing.tickets), 1000)
);

alter table ticketing.tickets
  alter column number set default nextval('ticketing.tickets_number_seq'),
  alter column number set not null,
  add constraint tickets_number_key unique (number);

-- The default runs nextval() as the inserting role: customers create
-- tickets as authenticated, tests and the triage pipeline as service_role.
grant usage on sequence ticketing.tickets_number_seq to authenticated, service_role;
