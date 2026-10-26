# Names and pictures: `ticketing.profile_cards`

SUP-24 shows people by display name and profile picture instead of by email
address. This page records how that is exposed, and why.

## The problem

`ticketing.profiles` holds each user's email; their role is in
`ticketing.workspace_members` (SUP-81). The read policy is deliberately
narrow (audit S4): you can read your own row; agents can read the staff
rows of their own workspace; admins can read everyone in their workspace.
Agents can't read customer profiles at all.

Showing a customer's *name* to the agent working their ticket therefore
needs a new read path. Widening the `profiles` policy isn't an option: RLS
filters rows, not columns, so any row an agent can see, they can see in
full, email and role included.

## The choice: a separate, narrow table

`ticketing.profile_cards` has one row per profile with only:

| column | |
|---|---|
| `id` | the profile's id |
| `display_name` | `profiles.full_name`; null when not set |
| `avatar_path` | `profiles.avatar_path`; the picture itself is served by `/avatar/...` |
| `is_staff` | whether the person is an agent or admin |

There is no email and no role column: a card reveals a person's name,
picture and whether they're staff -- never their email, and not which
staff role they hold.

A trigger on `profiles` (`profiles_sync_card`, SECURITY DEFINER) keeps the
cards in sync on insert and on any change to name, picture or role.
`authenticated` has `SELECT` only; nobody writes cards directly. A card is
deleted with its profile.

### Who can read whose card

The select policy's subqueries on `tickets` and `ticket_comments` run with
the caller's own RLS, so card visibility follows ticket visibility
exactly:

- **Your own card.**
- **Staff:** every staff card, and the card of anyone attached to a ticket
  they can see (as customer, assignee, filer or comment author). For an
  agent, that means unassigned tickets and their own; for an admin, every
  ticket. Because this doesn't depend on `is_staff`, a demoted colleague
  keeps their name on their old comments.
- **Customers:** the cards of staff assigned to, or commenting on, their
  own tickets. Internal notes are excluded by the comments policy. The
  staff member who *filed* a ticket for them isn't included, because the
  page says "our support team" there. A customer never sees another
  customer's card.

`tickets.created_by` and `ticket_comments.author_id` are indexed for these
lookups (migration `20261012060000`).

A customer chooses their own display name, so staff always see it marked
as the customer's ("Customer: Dana", "Dana (Customer)"). A customer can't
pass themselves off as support.

### Alternatives considered

- **A SECURITY DEFINER RPC returning names for given ids.** It would have
  to re-implement the ticket visibility rules in SQL. Anything a definer
  function does bypasses RLS, so getting those rules subtly wrong would leak
  names.
- **A view over `profiles`.** A `security_invoker` view inherits the
  `profiles` policy, which hides customers from agents, so it doesn't solve
  the problem. A definer view bypasses RLS entirely.
- **Column grants on `profiles`.** These can't vary by viewer, and the app
  already relies on reading email and role where it's allowed.

## Fallbacks in the UI

When a name isn't set or the card isn't visible, the app falls back to:

- the email, for staff looking at staff, which they can already read;
- "Customer", for staff looking at a customer;
- "Support team", for a customer looking at staff.

A customer sees a staff member as "Priya (Support)"; staff see a customer
as "Dana (Customer)".

## Tests

`tests/people.spec.ts` checks:

- a card has exactly the four columns above;
- an agent can't read a customer's card until a ticket of theirs becomes
  visible, and still can't read the customer's `profiles` row;
- a customer sees only the staff on their own tickets and never another
  customer's card;
- the ticket page shows the names.
