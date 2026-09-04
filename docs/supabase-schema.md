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
`update` on `full_name`/`updated_at` only -- `role` and `email` are excluded at the
column-privilege level, independent of RLS, so even an RLS policy bug could not let a client
rewrite their own role or impersonate another address in the admin UI. `email` is unique
(`lower(email)`) and kept in sync from `auth.users` by trigger.

### `ticketing.tickets`

The core entity. Everything a customer may see about their own ticket is here; the AI-derived
working state (priority/category/team/triage status) is deliberately **not** -- it lives in the
staff-only `ticket_triage_state` table below, so a customer cannot read the model's verdict on
their own submission even through the Data API.

| Column              | Type                        | Notes                                                                        |
|---------------------|-----------------------------|------------------------------------------------------------------------------|
| `id`                | `uuid`                      | Primary key, `gen_random_uuid()`.                                            |
| `customer_id`       | `uuid`                      | FK -> `auth.users.id`, `on delete cascade`. Defaults to `auth.uid()`. **Immutable.** |
| `subject`           | `text`                      | **Immutable** after insert.                                                  |
| `body`              | `text`                      | **Immutable** after insert.                                                  |
| `status`            | `ticketing.ticket_status`   | Default `new`. Transitions guarded by trigger (see below).                   |
| `assignee_id`       | `uuid`                      | FK -> `auth.users.id`, `on delete set null`. Must be null on insert.         |
| `first_response_at` | `timestamptz`               | Stamped by trigger on the first public staff comment. Never client-set.      |
| `resolved_at`       | `timestamptz`               | Stamped by trigger when status enters `resolved`; cleared if it leaves.      |
| `closed_at`         | `timestamptz`               | Stamped by trigger when status enters `closed`; cleared if it leaves.        |
| `created_at`        | `timestamptz`               | Default `now()`.                                                             |
| `updated_at`        | `timestamptz`               | Maintained by the `set_updated_at` trigger.                                  |

Indexes on `customer_id`, `assignee_id`, `status`.

### `ticketing.ticket_triage_state`

The AI-derived *working state* of a ticket, one row per ticket (created by trigger the moment
the ticket exists). **Staff-only**: RLS is `is_staff() and can_view_ticket(ticket_id)`, so for a
customer the row does not exist -- embedding it into a ticket read returns `null`. Written only
by the service role from the triage pipeline; the `triage_results` table keeps the full
append-only history of what the model said.

| Column          | Type                        | Notes                                                              |
|-----------------|-----------------------------|--------------------------------------------------------------------|
| `ticket_id`     | `uuid`                      | Primary key. FK -> `tickets.id`, `on delete cascade`.              |
| `triage_status` | `ticketing.triage_status`   | Default `pending`. The atomic `pending -> processing` claim lives here. |
| `priority`      | `ticketing.ticket_priority` | Nullable until triage runs.                                        |
| `category`      | `ticketing.ticket_category` | Nullable until triage runs.                                        |
| `team`          | `ticketing.ticket_team`     | Nullable until triage runs.                                        |
| `updated_at`    | `timestamptz`               | Maintained by trigger; used to detect a stale `processing` run.    |

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

### `ticketing.triage_results`

What the AI said about a ticket, one row per run (re-runs append). Written only by the
service role from `app/lib/ai/triage.ts`. See `docs/ai-triage.md` for field meanings.

| Column               | Type                        | Notes                                                        |
|----------------------|-----------------------------|--------------------------------------------------------------|
| `id`                 | `uuid`                      | Primary key.                                                 |
| `ticket_id`          | `uuid`                      | FK -> `tickets.id`, `on delete cascade`.                     |
| `model`              | `text`                      | OpenRouter slug that produced the row.                       |
| `prompt_version`     | `text`                      | `PROMPT_VERSION` in `app/lib/ai/triage.ts`.                  |
| `summary`            | `text`                      |                                                              |
| `category`           | `ticketing.ticket_category` |                                                              |
| `priority`           | `ticketing.ticket_priority` |                                                              |
| `priority_reason`    | `text`                      |                                                              |
| `team`               | `ticketing.ticket_team`     |                                                              |
| `frustration`        | `smallint`                  | 1..5 (check constraint).                                     |
| `is_escalation_risk` | `boolean`                   |                                                              |
| `duplicate_of`       | `uuid`                      | FK -> `tickets.id`, `on delete set null`.                    |
| `related_ticket_ids` | `uuid[]`                    |                                                              |
| `suggested_reply`    | `text`                      | Draft only; never sent automatically.                        |
| `missing_info`       | `text[]`                    |                                                              |
| `confidence`         | `real`                      | 0..1 (check constraint).                                     |
| `needs_human_review` | `boolean`                   | Set when validation fell back or confidence `< 0.5`.         |
| `raw`                | `jsonb`                     | The model's exact JSON, for debugging.                       |
| `prompt_tokens`, `completion_tokens`, `latency_ms` | `int` | Cost/latency tracking.                          |
| `cost_usd`           | `numeric(12,8)`             | Real combined embedding + completion cost billed by OpenRouter (`usage.cost`), not an estimate. Nullable for rows written before this column existed. |
| `created_at`         | `timestamptz`               |                                                              |

### `ticketing.ticket_embeddings`

Requires the `vector` extension (`create extension vector with schema extensions`). **Deny-all**
to end users; service role only.

| Column            | Type                       | Notes                                                                 |
|-------------------|----------------------------|-----------------------------------------------------------------------|
| `ticket_id`       | `uuid`                     | Primary key. FK -> `tickets.id`, `on delete cascade`.                 |
| `embedding`       | `extensions.vector(1536)`  | HNSW index with `vector_cosine_ops`. **Dimension is pinned** -- do not change. |
| `embedding_model` | `text`                     | Always `openai/text-embedding-3-small` today; recorded so a model change can find rows to re-embed. |
| `created_at`, `updated_at` | `timestamptz`     |                                                                       |

## Row Level Security

All grants to `authenticated` are the minimum each table needs; `service_role` has `all` on
every table and bypasses RLS entirely (it is confined to server-only code).

| Table             | select                                                                                        | insert                                                                              | update                                                             | delete |
|-------------------|-----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|--------------------------------------------------------------------|--------|
| `profiles`        | own row; admins: every row; agents: staff rows only                                           | none (trigger/RPC only)                                                             | none -- nothing writes or renders `full_name`; `email` is synced from `auth.users`, `role` via RPC | none   |
| `tickets`         | `customer_id = auth.uid()`; or `is_admin()`; or agent and (`assignee_id = auth.uid()` or null) | caller's role must be `customer` (checked in the policy, not just the app), `customer_id = auth.uid()`, row must be in pristine state incl. null timestamps (see `tickets_insert_customer`); INSERT privilege limited to `customer_id, subject, body`; per-user rate limit enforced by trigger | `is_admin()`; or agent and (`assignee_id = auth.uid()` or null) on **both** old and new row -- and only columns `status, assignee_id` | none   |
| `ticket_comments` | `can_view_ticket(ticket_id)` and (`not is_internal` or `is_staff()`)                          | `author_id = auth.uid()` and `can_view_ticket(ticket_id)` and (`not is_internal` or `is_staff()`); INSERT privilege limited to `ticket_id, author_id, body, is_internal`; ticket must not be `closed`; per-user rate limit enforced by trigger | none                                                               | none   |
| `ticket_events`   | `is_staff()` and `can_view_ticket(ticket_id)`                                                 | none (trigger only)                                                                 | none                                                               | none   |
| `rate_limits`     | none                                                                                          | none                                                                                | none                                                               | none   |
| `triage_results`  | `is_staff()` and `can_view_ticket(ticket_id)`                                                 | none (service role only)                                                            | none                                                               | none   |
| `ticket_embeddings` | none                                                                                        | none                                                                                | none                                                               | none   |
| `ticket_triage_state` | `is_staff()` and `can_view_ticket(ticket_id)`                                             | none (trigger creates the row; service role writes it)                              | none                                                               | none   |

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
| `handle_new_user()` (trigger)                         | DEFINER   | On `auth.users` insert: creates a `profiles` row with `role` **hard-coded to `customer`**, ignoring signup metadata (blocks self-escalation). Skipped for a user with no email, so this trigger can never break the other app's signups on the shared `auth.users`. |
| `ensure_profile()`                                    | DEFINER   | Get-or-create the caller's profile (needed because `auth.users` is shared with notes-collections). Always creates as `customer`. |
| `admin_set_role(uuid, app_role)`                      | DEFINER   | The only path to change a role. Re-checks `is_admin()`; takes a transaction-scoped advisory lock so two concurrent demotions can't both pass the last-admin check; refuses changing your own role and demoting the last admin; demoting staff to `customer` unassigns their tickets so they return to the shared queue. |
| `set_updated_at()` (trigger)                          | INVOKER   | Maintains `tickets.updated_at`.                                                                               |
| `guard_ticket_update()` (trigger, `before update` on `tickets`) | DEFINER | Immutable `customer_id`/`subject`/`body`; `assignee_id` must be an agent or admin; legal status transitions (agents only -- admins bypass); stamps `resolved_at`/`closed_at`; writes `ticket_events`. DEFINER so it can insert into `ticket_events`. |
| `stamp_first_response()` (trigger, `after insert` on `ticket_comments`) | DEFINER | Sets `tickets.first_response_at` on the first public staff comment.                                    |
| `consume_rate_limit(text)`                            | DEFINER   | Fixed-window counter. The caller names only the action (`create_ticket` / `add_comment` / `rerun_triage`); limit and window are hard-coded per action inside the function, and the key's identity half comes from `auth.uid()` -- so a client can neither loosen its own limit, target another user's bucket, nor mint rows with made-up windows. Returns `false` when over the limit; prunes windows older than a day on ~1% of calls. |
| `create_triage_state()` (trigger, `after insert` on `tickets`) | DEFINER | Creates the ticket's `ticket_triage_state` row so the triage pipeline always has a row to claim. |
| `rate_limit_ticket_insert()`, `rate_limit_comment_insert()` (triggers, `before insert`) | INVOKER | Call `consume_rate_limit()` for the inserting user and raise `rate_limited:<action>` when over -- so the limit applies to direct Data API calls too, not just the app. Skipped for `service_role` (`auth.uid()` is null). |
| `sync_profile_email()` (trigger, `after update of email` on `auth.users`) | DEFINER | Keeps `profiles.email` equal to the auth email. Users cannot update `profiles.email` themselves. |
| `match_tickets(vector(1536), int, uuid)`              | INVOKER   | Nearest tickets by cosine distance (`<=>`), returning subject + latest summary only. EXECUTE revoked from PUBLIC; granted to `service_role` only. |

EXECUTE on every callable function above is revoked from `PUBLIC` and granted explicitly:
`authenticated` for the helpers, `ensure_profile`, `admin_set_role`, `consume_rate_limit` (RLS
policies and the rate-limit triggers run as the caller and need them), `service_role` where the
triage code calls them, and `service_role` only for `match_tickets`. `alter default privileges`
makes the same true for any function added later.

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

| Action          | Limit | Window     | Where enforced                                                     |
|-----------------|-------|------------|--------------------------------------------------------------------|
| `create_ticket` | 10    | 60 minutes | `BEFORE INSERT` trigger on `tickets` (database)                    |
| `add_comment`   | 30    | 10 minutes | `BEFORE INSERT` trigger on `ticket_comments` (database)            |
| `rerun_triage`  | 5     | 10 minutes | `rerunTriageAction()` via `checkRateLimit()` (no row is inserted) |

The insert limits are enforced in the database so that a user calling the Data API directly with
their session token is limited exactly like the app. The app maps the trigger's
`rate_limited:*` exception to a friendly form error (`RateLimitError`), never an unhandled
exception. Text lengths are also constrained in the database: `subject` 1-200, ticket `body`
1-20000, comment `body` 1-10000, `full_name` <= 120. Supabase Auth's own built-in sign-up/sign-in rate limits are configured in
the dashboard (Authentication -> Rate Limits) and are **not** captured by migrations.

## Admin surface

`/admin` (overview analytics) and `/admin/users` (role management) are gated by `requireAdmin()`
in the route-segment layout and again in each page. Analytics are aggregated in app code over a
bounded select that runs as the signed-in admin -- RLS is what makes it "all tickets". Role
changes call `admin_set_role()`; reassignment is a plain `tickets` update permitted for admins by
`tickets_update_staff` and validated by `guard_ticket_update()`.

## Notes

The `triaged` status
value exists in the enum and the transition map (`assigned -> triaged`) but nothing sets it
automatically -- AI triage is advisory and never changes `status`.
