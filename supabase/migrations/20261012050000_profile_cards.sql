-- SUP-24: show people by name and picture instead of email.
--
-- The question was how staff see a *customer's* name: agents can't read
-- customer profiles (audit S4), and widening the profiles policy would
-- expose whole rows -- email and role included -- because RLS works on
-- rows, not columns. So names and pictures get their own narrow table,
-- profile_cards: id, display name, picture path and whether the person is
-- staff. No email, no role. It's kept in sync from profiles by a trigger
-- and nothing writes it directly. See docs/profile-cards.md.
--
-- Who can see whose card (RLS, evaluated with the caller's own access to
-- tickets and comments, so it follows those policies exactly):
--   * your own card;
--   * staff: every staff card, and the card of any customer whose ticket
--     they can see (an agent: unassigned and their own; an admin: all);
--   * anyone: the card of a staff member who is assigned to, filed, or
--     wrote a visible comment on a ticket they can see -- for a customer,
--     the staff on their own tickets, never other customers.

create table ticketing.profile_cards (
  id uuid primary key references ticketing.profiles (id) on delete cascade,
  display_name text,
  avatar_path text,
  is_staff boolean not null default false
);

comment on table ticketing.profile_cards is
  'Display name and picture per profile, readable more widely than profiles. Never holds email or role. Written only by the profiles_sync_card trigger.';

alter table ticketing.profile_cards enable row level security;

grant select on ticketing.profile_cards to authenticated;
grant all on ticketing.profile_cards to service_role;

create policy "profile_cards_select" on ticketing.profile_cards
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (
      (select ticketing.is_staff())
      and (
        is_staff
        or exists (select 1 from ticketing.tickets t where t.customer_id = profile_cards.id)
      )
    )
    or (
      is_staff
      and (
        exists (
          select 1 from ticketing.tickets t
          where t.assignee_id = profile_cards.id or t.created_by = profile_cards.id
        )
        or exists (select 1 from ticketing.ticket_comments c where c.author_id = profile_cards.id)
      )
    )
  );

create or replace function ticketing.sync_profile_card()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into ticketing.profile_cards (id, display_name, avatar_path, is_staff)
  values (new.id, new.full_name, new.avatar_path, new.role in ('agent', 'admin'))
  on conflict (id) do update
    set display_name = excluded.display_name,
        avatar_path = excluded.avatar_path,
        is_staff = excluded.is_staff;
  return new;
end;
$$;

revoke all on function ticketing.sync_profile_card() from public;

create trigger profiles_sync_card
  after insert or update of full_name, avatar_path, role on ticketing.profiles
  for each row execute function ticketing.sync_profile_card();

insert into ticketing.profile_cards (id, display_name, avatar_path, is_staff)
select p.id, p.full_name, p.avatar_path, p.role in ('agent', 'admin')
from ticketing.profiles p
on conflict (id) do nothing;
