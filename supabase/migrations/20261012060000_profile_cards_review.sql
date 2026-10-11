-- Review of SUP-24 (PR #31):
--   * The policy's lookups on tickets.created_by and
--     ticket_comments.author_id had no index, so every card check could
--     scan both tables.
--   * Staff lost the name of a demoted colleague on that person's old
--     comments and tickets (the staff branch only allowed is_staff cards
--     and customers). Staff now see anyone attached -- as customer,
--     assignee, filer or comment author -- to a ticket they can see.
--   * Customers could read the card of the staff member who *filed* their
--     ticket, though the page deliberately says "our support team". The
--     non-staff branch now covers only assignees and comment authors.

create index if not exists tickets_created_by_idx on ticketing.tickets (created_by);
create index if not exists ticket_comments_author_id_idx on ticketing.ticket_comments (author_id);

drop policy "profile_cards_select" on ticketing.profile_cards;

create policy "profile_cards_select" on ticketing.profile_cards
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or (
      (select ticketing.is_staff())
      and (
        is_staff
        or exists (
          select 1 from ticketing.tickets t
          where t.customer_id = profile_cards.id
             or t.assignee_id = profile_cards.id
             or t.created_by = profile_cards.id
        )
        or exists (select 1 from ticketing.ticket_comments c where c.author_id = profile_cards.id)
      )
    )
    or (
      is_staff
      and (
        exists (select 1 from ticketing.tickets t where t.assignee_id = profile_cards.id)
        or exists (select 1 from ticketing.ticket_comments c where c.author_id = profile_cards.id)
      )
    )
  );
