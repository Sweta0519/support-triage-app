-- SUP-39: team labels on tickets, Linear-style -- a name and a colour,
-- added to and removed from tickets by staff, shown on the cards.
--
-- Staff only: customers can't read or write either table (no policy
-- matches them). Any staff member may create, rename, recolour and delete
-- labels (the user's choice, like Linear); applying one to a ticket needs
-- a ticket the caller can see (can_view_ticket, under their own RLS).
-- Every add/remove is recorded in ticket_events by a trigger.

create table ticketing.labels (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint labels_name_length check (char_length(btrim(name)) between 1 and 40),
  -- A fixed palette (app/lib/labels.ts) rather than free hex, so every
  -- colour has a matching dark-mode tone.
  color text not null default 'gray'
    constraint labels_color_check check (color in ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'sky', 'blue', 'violet', 'pink')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index labels_name_unique on ticketing.labels (lower(btrim(name)));

create table ticketing.ticket_labels (
  ticket_id uuid not null references ticketing.tickets (id) on delete cascade,
  label_id uuid not null references ticketing.labels (id) on delete cascade,
  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (ticket_id, label_id)
);

create index ticket_labels_label_id_idx on ticketing.ticket_labels (label_id);

alter table ticketing.labels enable row level security;
alter table ticketing.ticket_labels enable row level security;

grant select, insert, update, delete on ticketing.labels to authenticated;
grant select, insert, delete on ticketing.ticket_labels to authenticated;
grant all on ticketing.labels to service_role;
grant all on ticketing.ticket_labels to service_role;
-- created_by / added_by are set by defaults below, never by the client.
revoke update (created_by, created_at) on ticketing.labels from authenticated;

alter table ticketing.labels alter column created_by set default auth.uid();
alter table ticketing.ticket_labels alter column added_by set default auth.uid();

create policy "labels_staff_select" on ticketing.labels
  for select to authenticated using ((select ticketing.is_staff()));
create policy "labels_staff_insert" on ticketing.labels
  for insert to authenticated
  with check ((select ticketing.is_staff()) and created_by = (select auth.uid()));
create policy "labels_staff_update" on ticketing.labels
  for update to authenticated
  using ((select ticketing.is_staff())) with check ((select ticketing.is_staff()));
create policy "labels_staff_delete" on ticketing.labels
  for delete to authenticated using ((select ticketing.is_staff()));

create policy "ticket_labels_staff_select" on ticketing.ticket_labels
  for select to authenticated
  using ((select ticketing.is_staff()) and (select ticketing.can_view_ticket(ticket_id)));
create policy "ticket_labels_staff_insert" on ticketing.ticket_labels
  for insert to authenticated
  with check (
    (select ticketing.is_staff())
    and (select ticketing.can_view_ticket(ticket_id))
    and added_by = (select auth.uid())
  );
create policy "ticket_labels_staff_delete" on ticketing.ticket_labels
  for delete to authenticated
  using ((select ticketing.is_staff()) and (select ticketing.can_view_ticket(ticket_id)));

-- History: label_added / label_removed with the label's name, by the
-- signed-in staff member. SECURITY DEFINER because authenticated has no
-- insert grant on ticket_events. A label deleted outright cascades its
-- ticket_labels rows; those removals are recorded too.
create or replace function ticketing.record_ticket_label_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    select l.name into v_name from ticketing.labels l where l.id = new.label_id;
    insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
    values (new.ticket_id, auth.uid(), 'label_added', null, v_name);
    return new;
  end if;
  select l.name into v_name from ticketing.labels l where l.id = old.label_id;
  insert into ticketing.ticket_events (ticket_id, actor_id, event_type, from_value, to_value)
  values (old.ticket_id, auth.uid(), 'label_removed', v_name, null);
  return old;
end;
$$;

revoke all on function ticketing.record_ticket_label_change() from public;

create trigger ticket_labels_record_change
  after insert or delete on ticketing.ticket_labels
  for each row execute function ticketing.record_ticket_label_change();
