# Names and pictures: `ticketing.profile_cards`

SUP-24 shows people by display name and profile picture instead of by email
address. This page records how that is exposed, and why.

## The problem

`ticketing.profiles` holds each user's email and role. Its read policy is
deliberately narrow (audit S4): you can read your own row; agents can read
staff rows; admins can read everything. Agents can't read customer
profiles at all.

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

There is no email and no role column, so nothing that can read a card can
learn either.

A trigger on `profiles` (`profiles_sync_card`, SECURITY DEFINER) keeps the
cards in sync on insert and on any change to name, picture or role.
`authenticated` has `SELECT` only; nobody writes cards directly. A card is
deleted with its profile.

### Who can read whose card

The select policy's subqueries on `tickets` and `ticket_comments` run with
the caller's own RLS, so card visibility follows ticket visibility
exactly:

- **Your own card.**
- **Staff:** every staff card, and the card of any customer whose ticket
  they can see. For an agent that's unassigned tickets and their own; for
  an admin, every ticket.
- **Anyone:** the card of a staff member who is assigned to, filed, or
  commented on a ticket the caller can see. For a customer, that's the
  staff on their own tickets, with internal notes excluded by the comments
  policy. A customer never sees another customer's card.

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

A customer sees a staff member as "Priya (Support)".

## Tests

`tests/people.spec.ts` checks:

- a card has exactly the four columns above;
- an agent can't read a customer's card until a ticket of theirs becomes
  visible, and still can't read the customer's `profiles` row;
- a customer sees only the staff on their own tickets and never another
  customer's card;
- the ticket page shows the names.
