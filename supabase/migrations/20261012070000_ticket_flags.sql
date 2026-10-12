-- SUP-27: a personal "follow up" flag on tickets, set from the queue
-- card's quick-action menu, with a "Flagged" queue tab.
--
-- A flag belongs to one staff member and is visible only to them: RLS
-- scopes every operation to user_id = auth.uid(). Flagging needs a ticket
-- the caller can see right now (can_view_ticket(), under their own RLS);
-- a flag on a ticket that later leaves their view simply stops showing,
-- because the queue only lists tickets they can see. Rows go with the
-- ticket or the user (on delete cascade).

create table ticketing.ticket_flags (
  user_id uuid not null references auth.users (id) on delete cascade,
  ticket_id uuid not null references ticketing.tickets (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);

create index ticket_flags_ticket_id_idx on ticketing.ticket_flags (ticket_id);

alter table ticketing.ticket_flags enable row level security;

grant select, insert, delete on ticketing.ticket_flags to authenticated;
grant all on ticketing.ticket_flags to service_role;

create policy "ticket_flags_select_own" on ticketing.ticket_flags
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "ticket_flags_insert_own" on ticketing.ticket_flags
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
  );

create policy "ticket_flags_delete_own" on ticketing.ticket_flags
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- "Flagged" can be the tab a staff member's queue opens on.
alter table ticketing.profiles drop constraint profiles_queue_default_filter_check;
alter table ticketing.profiles
  add constraint profiles_queue_default_filter_check
    check (queue_default_filter in ('all', 'unassigned', 'mine', 'flagged'));
