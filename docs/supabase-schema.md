# Supabase schema

Source: [The Data API - exposing custom schemas — Supabase Docs](https://supabase.com/docs/guides/api/using-custom-schemas)

Project: **notes-collections** (ref `jcnsjjyayjkzgyybzcgr`) -- this app **shares its Supabase
project with `notes-collections`** rather than owning a dedicated project (the account was
already at the free-tier 2-project limit). `notes-collections` owns the `public` schema
(`notes`/`collections`/`tags`/`note_tags`); everything for this app lives in a separate
**`ticketing`** schema in the same database, created via migrations in `supabase/migrations/`
(unlike `notes-collections`, whose tables are managed by hand in the dashboard).

## Consequences of sharing a project

- **`auth.users` is shared.** There is one sign-up/sign-in pool for both apps -- a person who
  created an account via notes-collections can sign in to this app with the same credentials,
  and vice versa. This is a deliberate tradeoff, not an accident.
- A user who already existed in `auth.users` before ever visiting this app has no
  `ticketing.profiles` row and never fires the on-signup trigger. App code must get-or-create
  a profile on first touch (`ticketing.ensure_profile()`), not assume every signed-in user
  already has one.
- The `ticketing` schema must be added to **Data API -> Exposed schemas** in the Supabase
  dashboard (Settings -> API) before `supabase-js` can query it -- only `public` is exposed by
  default. Every client in `app/lib/auth/clients.ts` is created with `db.schema = 'ticketing'`
  so `app/lib/db/` never has to name the schema per query.
- `public` and `ticketing` never reference each other. RLS policies, helper functions, and
  grants in this app are scoped entirely to `ticketing.*`.

## Enums

| Enum                        | Values                                                                 |
|-----------------------------|------------------------------------------------------------------------|
| `ticketing.app_role`        | `customer`, `agent`, `admin`                                           |
| `ticketing.ticket_status`   | `new`, `triaged`, `assigned`, `in_progress`, `resolved`, `closed`      |
| `ticketing.ticket_priority` | `low`, `normal`, `high`, `urgent`                                      |
| `ticketing.ticket_category` | `general`, `billing`, `technical`, `bug`, `feature_request`, `account` |
| `ticketing.ticket_team`     | `support`, `billing`, `engineering`                                    |
| `ticketing.triage_status`   | `pending`, `processing`, `completed`, `failed`                         |

## Tables

### `ticketing.profiles`

One row per `auth.users.id`. Created automatically on signup, or lazily via
`ticketing.ensure_profile()` for pre-existing users.

| Column       | Type                 | Notes                                                    |
|--------------|----------------------|----------------------------------------------------------|
| `id`         | `uuid`               | Primary key. FK -> `auth.users.id`, `on delete cascade`. |
| `email`      | `text`               | Copied from `auth.users` at profile-creation time.       |
| `full_name`  | `text`               | Nullable, user-editable.                                 |
| `role`       | `ticketing.app_role` | Defaults to `customer`.                                  |
| `created_at` | `timestamptz`        | Default `now()`.                                         |
| `updated_at` | `timestamptz`        | Default `now()`.                                         |

`role` can **only** change via the `ticketing.admin_set_role()` RPC. Clients are granted
`update` on `email`/`full_name`/`updated_at` only -- `role` is excluded at the column-privilege
level, independent of RLS, so even an RLS policy bug could not let a client rewrite their own
role.

### `ticketing.tickets`

The core entity. `priority`/`category`/`team` are the *mutable working state*: nullable until
the AI triage agent (later milestone) seeds them, after which staff can override.

| Column              | Type                        | Notes                                                                        |
|---------------------|-----------------------------|------------------------------------------------------------------------------|
| `id`                | `uuid`                      | Primary key, `gen_random_uuid()`.                                            |
| `customer_id`       | `uuid`                      | FK -> `auth.users.id`, `on delete cascade`. Defaults to `auth.uid()`. **Immutable.** |
| `subject`           | `text`                      | **Immutable** after insert.                                                  |
| `body`              | `text`                      | **Immutable** after insert.                                                  |
| `status`            | `ticketing.ticket_status`   | Default `new`. Transitions guarded by trigger (see below).                   |
| `priority`          | `ticketing.ticket_priority` | Nullable. Must be null on insert.                                            |
| `category`          | `ticketing.ticket_category` | Nullable. Must be null on insert.                                            |
| `team`              | `ticketing.ticket_team`     | Nullable. Must be null on insert.                                            |
| `assignee_id`       | `uuid`                      | FK -> `auth.users.id`, `on delete set null`. Must be null on insert.         |
| `triage_status`     | `ticketing.triage_status`   | Default `pending`. Must be `pending` on insert.                              |
| `first_response_at` | `timestamptz`               | Stamped by trigger on the first public staff comment. Never client-set.      |
| `resolved_at`       | `timestamptz`               | Stamped by trigger when status enters `resolved`; cleared if it leaves.      |
| `closed_at`         | `timestamptz`               | Stamped by trigger when status enters `closed`; cleared if it leaves.        |
| `created_at`        | `timestamptz`               | Default `now()`.                                                             |
| `updated_at`        | `timestamptz`               | Maintained by the `set_updated_at` trigger.                                  |

Indexes on `customer_id`, `assignee_id`, `status`.

### `ticketing.ticket_comments`

Thread on a ticket. **Immutable** -- there is no update or delete policy.

| Column        | Type          | Notes                                                             |
|---------------|---------------|-------------------------------------------------------------------|
| `id`          | `uuid`        | Primary key.                                                      |
| `ticket_id`   | `uuid`        | FK -> `tickets.id`, `on delete cascade`.                          |
| `author_id`   | `uuid`        | FK -> `auth.users.id`, `on delete cascade`. Must equal `auth.uid()` on insert. |
| `body`        | `text`        |                                                                   |
| `is_internal` | `boolean`     | Default `false`. Staff-only notes the customer never sees.        |
| `created_at`  | `timestamptz` | Default `now()`.                                                  |

### `ticketing.ticket_events`

Append-only audit trail. **Written only by triggers** -- `authenticated` has no insert grant
at all, so a client can never fabricate an event.

| Column       | Type          | Notes                                                                 |
|--------------|---------------|-----------------------------------------------------------------------|
| `id`         | `uuid`        | Primary key.                                                          |
| `ticket_id`  | `uuid`        | FK -> `tickets.id`, `on delete cascade`.                              |
| `actor_id`   | `uuid`        | FK -> `auth.users.id`, `on delete set null`. `null` = system/AI action. |
| `event_type` | `text`        | Currently `status_changed` or `assignee_changed`.                     |
| `from_value` | `text`        |                                                                       |
| `to_value`   | `text`        |                                                                       |
| `created_at` | `timestamptz` | Default `now()`.                                                      |

### `ticketing.rate_limits`

Fixed-window counters backing `ticketing.consume_rate_limit()`. **Deny-all**: RLS enabled,
zero policies, zero grants to `authenticated`. Only reachable through the RPC.

| Column         | Type          | Notes                                              |
|----------------|---------------|----------------------------------------------------|
| `key`          | `text`        | `<auth.uid()>:<action>`. Part of the primary key.  |
| `window_start` | `timestamptz` | Start of the fixed window. Part of the primary key. |
| `count`        | `int`         | Requests seen in this window.                      |

## Row Level Security

All grants to `authenticated` are the minimum each table needs; `service_role` has `all` on
every table and bypasses RLS entirely (it is confined to server-only code).

| Table             | select                                                                                        | insert                                                                              | update                                                             | delete |
|-------------------|-----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|--------------------------------------------------------------------|--------|
| `profiles`        | own row; or any row if `is_staff()`                                                           | none (trigger/RPC only)                                                             | own row, non-`role` columns only                                   | none   |
| `tickets`         | `customer_id = auth.uid()`; or `is_admin()`; or agent and (`assignee_id = auth.uid()` or null) | customer only, row must be in pristine state (see `tickets_insert_customer`)        | `is_admin()`; or agent and (`assignee_id = auth.uid()` or null) on **both** old and new row | none   |
| `ticket_comments` | `can_view_ticket(ticket_id)` and (`not is_internal` or `is_staff()`)                          | `author_id = auth.uid()` and `can_view_ticket(ticket_id)` and (`not is_internal` or `is_staff()`) | none                                                               | none   |
| `ticket_events`   | `is_staff()`                                                                                  | none (trigger only)                                                                 | none                                                               | none   |
| `rate_limits`     | none                                                                                          | none                                                                                | none                                                               | none   |

Two things RLS deliberately does *not* try to do, because it can't:

- **Column-level control.** RLS is row-level only. What stops an agent from rewriting `subject`,
  or flipping `status` from `new` straight to `closed`, is the `guard_ticket_update` trigger
  below -- not a policy.
- **Race-free claiming.** The `tickets` update policy has the identical `assignee_id = auth.uid()
  or assignee_id is null` condition on both the old row (`using`) and the new row (`with check`).
  App code claims with `update ... where id = $1 and assignee_id is null`; if two agents race,
  Postgres serializes the two UPDATEs and the loser's WHERE clause matches zero rows.

## Functions

| Function                                              | Security  | Purpose                                                                                                       |
|-------------------------------------------------------|-----------|---------------------------------------------------------------------------------------------------------------|
| `app_role()`, `is_staff()`, `is_admin()`              | DEFINER   | Role lookups used inside policies. DEFINER so a `profiles` policy can check the caller's role without recursing into itself. |
| `can_view_ticket(uuid)`                               | **INVOKER** | "Can the caller see this ticket?" for child tables. INVOKER on purpose: it inherits the caller's own `tickets` RLS. Making it DEFINER would bypass ticket RLS for every child table. |
| `handle_new_user()` (trigger)                         | DEFINER   | On `auth.users` insert: creates a `profiles` row with `role` **hard-coded to `customer`**, ignoring signup metadata (blocks self-escalation). |
| `ensure_profile()`                                    | DEFINER   | Get-or-create the caller's profile (needed because `auth.users` is shared with notes-collections). Always creates as `customer`. |
| `admin_set_role(uuid, app_role)`                      | DEFINER   | The only path to change a role. Re-checks `is_admin()` internally.                                            |
| `set_updated_at()` (trigger)                          | INVOKER   | Maintains `tickets.updated_at`.                                                                               |
| `guard_ticket_update()` (trigger, `before update` on `tickets`) | DEFINER | Immutable `customer_id`/`subject`/`body`; legal status transitions (agents only -- admins bypass); stamps `resolved_at`/`closed_at`; writes `ticket_events`. DEFINER so it can insert into `ticket_events`. |
| `stamp_first_response()` (trigger, `after insert` on `ticket_comments`) | DEFINER | Sets `tickets.first_response_at` on the first public staff comment.                                    |
| `consume_rate_limit(text, int, int)`                  | DEFINER   | Fixed-window counter. Derives the key's identity half from `auth.uid()` *inside* the function -- a caller can't target another user's bucket. Returns `false` when over the limit. |

### Status transition map

Enforced for agents by `guard_ticket_update()`; mirrored in `ALLOWED_STATUS_TRANSITIONS` in
`app/lib/db/tickets.ts` purely to decide which buttons to render. Admins may set any status.

| From          | Allowed to               |
|---------------|--------------------------|
| `new`         | `assigned`, `in_progress` |
| `triaged`     | `assigned`, `in_progress` |
| `assigned`    | `in_progress`, `triaged`  |
| `in_progress` | `resolved`, `assigned`    |
| `resolved`    | `closed`, `in_progress`   |
| `closed`      | (terminal)                |

## Rate limits in use

| Action          | Limit | Window     | Where enforced                       |
|-----------------|-------|------------|--------------------------------------|
| `create_ticket` | 10    | 60 minutes | `createTicket()` in `app/lib/db/tickets.ts`  |
| `add_comment`   | 30    | 10 minutes | `addComment()` in `app/lib/db/comments.ts`   |

Both surface as a friendly form error (`RateLimitError` caught in the Server Action), never an
unhandled exception. Supabase Auth's own built-in sign-up/sign-in rate limits are configured in
the dashboard (Authentication -> Rate Limits) and are **not** captured by migrations.

## Not in this schema (yet)

AI triage (`triage_results`, `ticket_embeddings` with `vector(1536)`) and the admin surface are
later milestones and will be added as further migrations.
