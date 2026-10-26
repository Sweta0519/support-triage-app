# Supabase schema

Source: [The Data API - exposing custom schemas — Supabase Docs](https://supabase.com/docs/guides/api/using-custom-schemas)

Project: **support-triage** (ref `jcnsjjyayjkzgyybzcgr`). Everything for this app lives in the
**`ticketing`** schema, created via migrations in `supabase/migrations/`.

## History: a project that used to be shared (SUP-79)

This app started inside the Supabase project of a separate app, `notes-collections`, because
the account was already at the free tier's 2-project limit. notes-collections owned the
`public` schema (`notes`/`collections`/`tags`/`note_tags`), and both apps used one `auth.users`
pool, so a notes-collections account could sign in here too.

On 2026-10-24 notes-collections was retired and the project renamed `support-triage`:

- Its four `public` tables were backed up (a JSON export, kept outside the repo) and dropped
  by `20261024000000_drop_notes_collections_tables.sql`. `public` is now empty.
  Before the drop, a catalog check found nothing else in `public`: no views, functions or
  types, only the four tables and their id sequences.
- Its 4 sign-in accounts were deleted, so every user in `auth.users` is a Support Triage user.
  They were the users with no `ticketing.profiles` row. Their emails were listed and the owner
  confirmed each one as an old notes-collections test account before the delete, which named
  the 4 emails explicitly.

Older migrations, comments and review docs still say the project is shared. They describe
how things were when they were written.

## What still applies

- **RoboMart shares the database, not the sign-ins.** The RoboMart shop (Payload + Stripe)
  keeps its own `robomart` schema here. It doesn't use Supabase Auth: Payload has its own
  `robomart.users`, and nothing in `robomart` references `auth.users`. `ticketing` and
  `robomart` never reference each other. The database, its quotas and the service-role key
  are still shared, so a leaked RoboMart service-role key would expose `ticketing` too. Move
  RoboMart to its own project once a free slot opens or the org moves to Pro.
- **Keep calling `ticketing.ensure_profile()`.** Every current user has a profile, and the
  on-signup trigger creates one for each new user. But get-or-create on first touch stays the
  rule, so code never assumes the row exists.
- The `ticketing` schema must be added to **Data API -> Exposed schemas** in the Supabase
  dashboard (Settings -> API) before `supabase-js` can query it -- only `public` is exposed by
  default. Every client in `app/lib/auth/clients.ts` is created with `db.schema = 'ticketing'`
  so `app/lib/db/` never has to name the schema per query.
- `public` and `ticketing` never reference each other. RLS policies, helper functions, and
  grants in this app are scoped entirely to `ticketing.*`.

## Workspaces: one support team each (SUP-78)

Since 2026-10-24 the app holds many support teams, each in its own **workspace**. Built in
three parts: the schema and RLS (SUP-81, PR #88), sign-up and invites (SUP-82, PR #89), and
workspace-wide AI budgets plus an A/B isolation test (SUP-83, PR #93).

- **One workspace per person.** `workspace_members.user_id` is the primary key, so a person's
  role and workspace are a single row. The role moved there from `profiles.role`, which was
  dropped. `app_role()`, `is_staff()` and `is_admin()` read the membership on every call, never
  a JWT claim, so a demotion takes effect at once.
- **How people get in.** A plain sign-up names a new workspace and becomes its admin. A
  customer signs up through the workspace's join link (`/join/<token>`), and an agent through a
  single-use, 7-day invite link (`/invite/<token>`) made for their email. Admins copy and share
  both links from Admin > Workspace; the app sends no email. A sign-up with none of these, which
  includes "Get in touch", joins the **default workspace** (`is_default`, which held everything
  before SUP-78) as a customer. The role is never read from sign-up metadata: `handle_new_user()`
  checks the name or token and works the role out itself.
- **`workspace_id` on every shared table.** The roots (`tickets`, `labels`, `incidents`) and
  every table that hangs off a ticket carry it. A ticket takes its customer's workspace, a child
  row its ticket's, and a label its creator's, from triggers; an incident takes the triaged
  ticket's, in `detect_incident()`. It never comes from a signed-in client. A
  composite foreign key to `tickets (id, workspace_id)` (and to `labels` / `incidents` for the
  link tables) makes a row in the wrong workspace impossible, not just unlikely. The one
  exception is `profile_cards.workspace_id`: nullable (`on delete set null`, since a profile can
  exist a moment before its membership) and kept in sync from the membership by
  `sync_member_card()`.
- **Personal tables stay owner-scoped:** `notes`, `documents`, `assistant_*` and
  `access_tokens` have no `workspace_id`. A person has one workspace, so their own rows are
  already inside it.
- **Every RLS policy also checks `workspace_id = current_workspace_id()`**, and every
  `SECURITY DEFINER` function, which bypasses RLS, filters by the workspace itself.
- **The AI never crosses workspaces.** The service-role AI functions (`match_tickets()`,
  `match_triage_corrections()`, `detect_incident()`) take the workspace from the ticket being
  triaged, so duplicate and related candidates, correction examples and incident members all
  come from that workspace. `check_triage_result_workspace()` refuses to store a related ticket
  from another workspace, and `duplicate_of` has a composite foreign key.
- **Leaving.** A workspace's last admin can't delete their account while other members remain,
  and the default workspace always keeps an admin. When the last member of any other workspace
  leaves, the workspace is deleted with everything in it.
- **Proof:** `tests/workspace-isolation.spec.ts` creates workspaces A and B and checks that a
  customer, an agent and an admin in A can't see or change anything in B, through the web app,
  the database API, MCP and Sage, and that triage never offers a B ticket.

## Enums

| Enum                        | Values                                                                 |
|-----------------------------|------------------------------------------------------------------------|
| `ticketing.app_role`        | `customer`, `agent`, `admin` (held in `workspace_members.role`)        |
| `ticketing.ticket_status`   | `new`, `triaged`, `assigned`, `in_progress`, `resolved`, `closed`      |
| `ticketing.ticket_priority` | `low`, `normal`, `high`, `urgent`                                      |
| `ticketing.ticket_category` | `general`, `billing`, `technical`, `bug`, `feature_request`, `account` |
| `ticketing.ticket_team`     | `support`, `billing`, `engineering`                                    |
| `ticketing.triage_status`   | `pending`, `processing`, `completed`, `failed`                         |

## Tables

### `ticketing.workspaces`

One row per support team.

| Column       | Type          | Notes                                                                 |
|--------------|---------------|-----------------------------------------------------------------------|
| `id`         | `uuid`        | Primary key.                                                          |
| `name`       | `text`        | 1-80 characters, named at sign-up.                                    |
| `is_default` | `boolean`     | `true` for exactly one row (partial unique index): the workspace that held everything before SUP-78. New sign-ups with no link, including "Get in touch", join it. It is never deleted. |
| `join_token` | `text`        | Unique, 24 random bytes in hex. The customer sign-up link `/join/<token>`. Not readable through a column grant: only an admin gets it, through `workspace_join_token()`, and `rotate_workspace_join_token()` replaces it (the old link stops working at once). |
| `created_at` | `timestamptz` | Default `now()`.                                                      |

### `ticketing.workspace_members`

A person's workspace and their role in it.

| Column         | Type                 | Notes                                                                |
|----------------|----------------------|----------------------------------------------------------------------|
| `user_id`      | `uuid`               | **Primary key** (one workspace per person). FK -> `profiles.id`, `on delete cascade`. |
| `workspace_id` | `uuid`               | FK -> `workspaces.id`, `on delete cascade`.                          |
| `role`         | `ticketing.app_role` | Default `customer`. Written only by `handle_new_user()`, `ensure_profile()` and `admin_set_role()`: `authenticated` has `select` only. |
| `created_at`   | `timestamptz`        | Default `now()`.                                                     |

Deleting the last member of a workspace other than the default one deletes the workspace
(`delete_empty_workspace()` trigger), and with it every ticket, label and incident in it.

### `ticketing.workspace_invites`

Agent invites. Only the token's sha256 is kept: the link is shown to the admin once.

| Column                       | Type          | Notes                                                    |
|------------------------------|---------------|----------------------------------------------------------|
| `id`                         | `uuid`        | Primary key.                                             |
| `workspace_id`               | `uuid`        | FK -> `workspaces.id`, `on delete cascade`.              |
| `email`                      | `text`        | The only address the invite works for (lower-cased).     |
| `token_hash`                 | `text`        | Unique. Not in any client column grant.                  |
| `created_by`, `accepted_by`  | `uuid`        | FK -> `profiles.id`, `on delete set null`.               |
| `created_at`, `expires_at`   | `timestamptz` | Expires 7 days after it was made.                        |
| `accepted_at`, `revoked_at`  | `timestamptz` | Single use: set when accepted. A new invite for the same email revokes the pending one. |

### `ticketing.profiles`

One row per `auth.users.id`. Created automatically on signup, or lazily via
`ticketing.ensure_profile()` for pre-existing users.

| Column       | Type                 | Notes                                                    |
|--------------|----------------------|----------------------------------------------------------|
| `id`         | `uuid`               | Primary key. FK -> `auth.users.id`, `on delete cascade`. |
| `email`      | `text`               | Copied from `auth.users` at profile-creation time.       |
| `full_name`  | `text`               | Nullable, user-editable.                                 |
| `presence`   | `text`               | `online` / `away` / `offline`, default `online`. The person's last pick, via `set_own_presence()` (SUP-76). The status shown follows their working hours unless this pick is newer than the last shift start or end (SUP-85, `app/lib/work-hours.ts`). A label only: it never changes assignment or status. |
| `presence_set_at` | `timestamptz`   | Nullable. When the person last picked a status (`set_own_presence()`), or `infinity` after signing out (`sign_out_presence()`), which holds Offline until `resume_presence_after_sign_in()` clears it on the next sign-in (SUP-85). |
| `daily_case_cap` | `int`            | Nullable (null = no cap), 0-200. New cases a day; set by `admin_set_workload()` (SUP-77). |
| `timezone`   | `text`               | IANA name, default `UTC`. Says when the person's day starts, for the cap, and the zone their working hours are in. |
| `work_days`, `work_start`, `work_end` | `smallint[]`, `time`, `time` | Working hours (SUP-85): ISO weekdays (1 = Monday) and the shift's start and end; an end before the start runs into the next day, and an equal start and end is a 24-hour shift. All null = no schedule (`profiles_work_hours_check`). Set by `admin_set_workload()`. |
| `created_at` | `timestamptz`        | Default `now()`.                                         |
| `updated_at` | `timestamptz`        | Default `now()`.                                         |

The role is not here any more: it is `workspace_members.role` (SUP-81), and it can **only**
change via the `ticketing.admin_set_role()` RPC. Clients are granted `update` on
`full_name`/`updated_at` only -- `email` is excluded at the column-privilege level, independent
of RLS, so even an RLS policy bug could not let a client impersonate another address in the
admin UI. `email` is unique (`lower(email)`) and kept in sync from `auth.users` by trigger.

### `ticketing.tickets`

The core entity. Everything a customer may see about their own ticket is here; the AI-derived
working state (priority/category/team/triage status) is deliberately **not** -- it lives in the
staff-only `ticket_triage_state` table below, so a customer cannot read the model's verdict on
their own submission even through the Data API.

| Column              | Type                        | Notes                                                                        |
|---------------------|-----------------------------|------------------------------------------------------------------------------|
| `id`                | `uuid`                      | Primary key, `gen_random_uuid()`.                                            |
| `number`            | `bigint`                    | Short readable number (#1042) from `tickets_number_seq`; unique, never client-set. |
| `workspace_id`      | `uuid`                      | FK -> `workspaces.id`, `on delete cascade`. Always the customer's workspace, set by the `tickets_000_set_workspace` trigger whoever files the ticket; an assignee given at insert must be staff in that workspace. Never client-set, and the update guard refuses a change. |
| `customer_id`       | `uuid`                      | FK -> `auth.users.id`, `on delete cascade`. Defaults to `auth.uid()`. **Immutable.** |
| `subject`           | `text`                      | **Immutable** after insert.                                                  |
| `body`              | `text`                      | **Immutable** after insert.                                                  |
| `status`            | `ticketing.ticket_status`   | Default `new`. Transitions guarded by trigger (see below).                   |
| `assignee_id`       | `uuid`                      | FK -> `auth.users.id`, `on delete set null`. Must be null on a customer's insert. |
| `created_by`        | `uuid`, nullable            | The staff member who filed it on the customer's behalf; null = filed by the customer. FK -> `auth.users.id`, `on delete set null`. Outside every client column grant: only `staff_create_ticket()` sets it. |
| `first_response_at` | `timestamptz`               | Stamped by trigger on the first public staff comment. Never client-set.      |
| `resolved_at`       | `timestamptz`               | Stamped by trigger when status enters `resolved`; cleared if it leaves.      |
| `closed_at`         | `timestamptz`               | Stamped by trigger when status enters `closed`; cleared if it leaves.        |
| `created_at`        | `timestamptz`               | Default `now()`.                                                             |
| `updated_at`        | `timestamptz`               | Maintained by the `set_updated_at` trigger.                                  |

Indexes on `customer_id`, `assignee_id`, `status`.

**Who can insert.** A customer inserts their own ticket through the column grant
`(customer_id, subject, body)` and the `tickets_insert_customer` policy. Staff file a ticket on a
customer's behalf (phone, chat, email) only through `ticketing.staff_create_ticket(email,
subject, body, assign_to_me)`, a SECURITY DEFINER function that re-checks `is_staff()`, charges
the caller's `staff_create_ticket` rate-limit bucket (30/hour) on **every** call -- so probing
emails costs the same as filing -- resolves the email to an existing *customer* profile
(returning null otherwise, never anything about the customer), inserts with `created_by`, and
writes `filed_by_staff` (plus `status_changed` / `assignee_changed` when it assigns the caller).

### `ticketing.ticket_triage_state`

The AI-derived *working state* of a ticket, one row per ticket (created by trigger the moment
the ticket exists). **Staff-only**: RLS is `is_staff() and can_view_ticket(ticket_id)`, so for a
customer the row does not exist -- embedding it into a ticket read returns `null`. Written by
the service role from the triage pipeline and by staff only through `review_triage()`; there is
no write grant to `authenticated`. The `triage_results` table keeps the full append-only history
of what the model said.

| Column          | Type                        | Notes                                                              |
|-----------------|-----------------------------|--------------------------------------------------------------------|
| `ticket_id`     | `uuid`                      | Primary key. FK -> `tickets.id`, `on delete cascade`.              |
| `triage_status` | `ticketing.triage_status`   | Default `pending`. The atomic `pending -> processing` claim lives here. |
| `priority`      | `ticketing.ticket_priority` | Nullable until triage runs.                                        |
| `category`      | `ticketing.ticket_category` | Nullable until triage runs.                                        |
| `team`          | `ticketing.ticket_team`     | Nullable until triage runs.                                        |
| `updated_at`    | `timestamptz`               | Maintained by trigger; used to detect a stale `processing` run.    |
| `reviewed_by`   | `uuid`                      | Staff member who last confirmed/corrected the fields. FK -> `auth.users.id`, `on delete set null`. |
| `reviewed_at`   | `timestamptz`               | Null until reviewed. Once set, a triage re-run no longer overwrites `priority`/`category`/`team`. |
| `reviewed_result_id` | `uuid`                 | The `triage_results` run the reviewer was shown. FK, `on delete set null`. |

### `ticketing.ticket_comments`

Thread on a ticket. **Immutable** -- there is no update or delete policy.

| Column        | Type          | Notes                                                             |
|---------------|---------------|-------------------------------------------------------------------|
| `id`          | `uuid`        | Primary key.                                                      |
| `ticket_id`   | `uuid`        | FK -> `tickets.id`, `on delete cascade`.                          |
| `author_id`   | `uuid`, nullable | FK -> `auth.users.id`, `on delete set null` (was `cascade`): a staff member deleting their account leaves their replies on customers' tickets, unattributed. Must equal `auth.uid()` on insert. |
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
| `key`          | `text`        | `<auth.uid()>:<action>` per person, `ws:<workspace_id>:<action>` for a workspace-wide budget (SUP-83), or an IP key: `public_share:<ip>` (the status page) and `workspace_link:<ip>` (the join and invite links). Part of the primary key. |
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

### `ticketing.assistant_conversations` / `ticketing.assistant_messages`

Sage, the staff assistant widget. One conversation per staff member (`unique (owner_id)`), so
`getOrCreateActiveConversation()` is insert-first / select-on-conflict rather than read-then-write.

| Column (conversations) | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `owner_id` | `uuid` | FK -> `profiles.id`, cascade. Unique. |
| `title` | `text` | Unused today. |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` is touched by `appendMessage()`. |

| Column (messages) | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `conversation_id` | `uuid` | FK -> `assistant_conversations.id`, cascade. |
| `role` | `text` | `user` / `assistant`. |
| `content` | `text` | 1-8000 chars. |
| `model` | `text` | OpenRouter slug that produced an assistant reply; null for user messages. |
| `metadata` | `jsonb` | What Sage did behind a reply: `{"searches": [{"query", "matches"}]}` when it searched notes, `{}` otherwise. Display/provenance only. |
| `created_at` | `timestamptz` | |

### `ticketing.notes`

A staff member's private knowledge notes (runbooks, policies, customer context) -- the corpus
Sage's `search_notes` tool retrieves from. Owner-scoped: nobody else, including admins, can read
them.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `owner_id` | `uuid` | FK -> `profiles.id`, cascade. |
| `title` | `text` | 1-200 chars. |
| `body` | `text` | 1-20000 chars. |
| `created_at`, `updated_at` | `timestamptz` | `updated_at` by the shared `set_updated_at()` trigger. |

INSERT privilege is limited to `owner_id, title, body` and UPDATE to `title, body`, so a client
can never set ids/timestamps or move a note to another owner.

### `ticketing.documents`

The chunks + embeddings behind notes search, one row per ~500-character chunk. Named after the
Supabase semantic-search guide it follows. Read and written with the **caller's own session**
(no service role), so RLS is the isolation boundary.

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `note_id` | `uuid` | FK -> `notes.id`, `on delete cascade` -- deleting a note removes its chunks. `unique (note_id, chunk_index)`. |
| `user_id` | `uuid` | FK -> `profiles.id`, cascade. Denormalised from `notes.owner_id` so the search filters on a plain column. |
| `chunk_index` | `int` | Position within the note. |
| `content` | `text` | The chunk text (1-2000 chars). |
| `embedding` | `extensions.vector(1536)` | **No vector index on purpose** -- an HNSW scan post-filters the per-user predicate and can drop the user's own rows (see `docs/notes-rag.md`); per-user row counts are small enough for an exact scan via `documents_user_id_idx`. **Dimension pinned** -- same rule as `ticket_embeddings`. |
| `embedding_model` | `text` | `openai/text-embedding-3-small`; recorded per row so a model change can find rows to re-embed. |
| `created_at` | `timestamptz` | |

No UPDATE grant: chunks are immutable. Notes and their chunks are written only through
`save_note()`, which replaces every chunk in the same transaction as the note row, so a stale
vector from an earlier version can't linger and a note can't exist without its index.

## Row Level Security

All grants to `authenticated` are the minimum each table needs; `service_role` has `all` on
every table and bypasses RLS entirely (it is confined to server-only code).

**Every policy on a table with `workspace_id` also requires `workspace_id =
current_workspace_id()`** (SUP-81), on `using` and on `with check`. The table below leaves that
condition out of each row to stay readable; "admins: every row" means every row in their own
workspace. `profiles` has no `workspace_id`: its policy checks the other person's
`workspace_members` row instead.

| Table             | select                                                                                        | insert                                                                              | update                                                             | delete |
|-------------------|-----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------|--------------------------------------------------------------------|--------|
| `workspaces`      | own workspace only; `join_token` is outside the column grant                                  | none (sign-up trigger only)                                                         | none (`rotate_workspace_join_token()` only)                        | none (trigger, when the last member leaves) |
| `workspace_members` | own row; admins: every member of their workspace; agents: its staff rows                    | none (trigger/RPC only)                                                             | none (`admin_set_role()` only)                                     | none (cascade from the profile) |
| `workspace_invites` | admins of the workspace; `token_hash` is outside the column grant                           | none (`create_workspace_invite()` only)                                             | none (`revoke_workspace_invite()` only)                            | none   |
| `profiles`        | own row; admins: every member of their workspace; agents: its staff rows                      | none (trigger/RPC only)                                                             | none -- nothing writes or renders `full_name`; `email` is synced from `auth.users` | none   |
| `tickets`         | `customer_id = auth.uid()`; or `is_admin()`; or agent and (`assignee_id = auth.uid()` or null) | caller's role must be `customer` (checked in the policy, not just the app), `customer_id = auth.uid()`, row must be in pristine state incl. null timestamps (see `tickets_insert_customer`); INSERT privilege limited to `customer_id, subject, body`; per-user rate limit enforced by trigger | `is_admin()`; or agent and (`assignee_id = auth.uid()` or null) on **both** old and new row -- and only columns `status, assignee_id` | none   |
| `ticket_comments` | `can_view_ticket(ticket_id)` and (`not is_internal` or `is_staff()`)                          | `author_id = auth.uid()` and `can_view_ticket(ticket_id)` and (`not is_internal` or `is_staff()`); INSERT privilege limited to `ticket_id, author_id, body, is_internal`; ticket must not be `closed`; per-user rate limit enforced by trigger | none                                                               | none   |
| `ticket_events`   | `is_staff()` and `can_view_ticket(ticket_id)`                                                 | none (trigger only)                                                                 | none                                                               | none   |
| `rate_limits`     | none                                                                                          | none                                                                                | none                                                               | none   |
| `triage_results`  | `is_staff()` and `can_view_ticket(ticket_id)`                                                 | none (service role only)                                                            | none                                                               | none   |
| `ticket_embeddings` | none                                                                                        | none                                                                                | none                                                               | none   |
| `ticket_triage_state` | `is_staff()` and `can_view_ticket(ticket_id)`                                             | none (trigger creates the row; service role writes it)                              | none                                                               | none   |
| `assistant_conversations` | `owner_id = auth.uid()` and `is_staff()`                                              | same                                                                                | same (touches `updated_at`)                                        | none   |
| `assistant_messages` | parent conversation's `owner_id = auth.uid()`                                              | same                                                                                | none                                                               | none   |
| `notes`           | `owner_id = auth.uid()` and `is_staff()`                                                      | same; INSERT privilege limited to `owner_id, title, body`                           | same; UPDATE privilege limited to `title, body`                    | same   |
| `documents`       | `user_id = auth.uid()` and `is_staff()`                                                       | same, **and** `note_id` must be a note the caller owns                              | none (immutable; replaced on edit)                                 | same   |

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
| `app_role()`, `is_staff()`, `is_admin()`              | DEFINER   | Role lookups used inside policies, read from the caller's `workspace_members` row. DEFINER so a policy can check the caller's role without recursing into itself. |
| `current_workspace_id()`                              | DEFINER   | The caller's workspace, from `workspace_members` (`auth.uid()`, no parameter). Every workspace check in a policy calls it. |
| `set_ticket_workspace()` (`before insert` on `tickets`), `set_workspace_from_ticket()` (`before insert or update of ticket_id, workspace_id` on each ticket child), `set_label_workspace()` (`before insert` on `labels`) | DEFINER | Fill `workspace_id`: a ticket from its customer's membership, a ticket child from its ticket (again whenever its `ticket_id` or `workspace_id` changes), a label from the signed-in creator's membership. Whatever a signed-in client sent is overwritten; only the service role (no `auth.uid()`) may name a label's workspace. Incidents get theirs from `detect_incident()`, which takes it from the triaged ticket. |
| `check_triage_result_workspace()` (trigger on `triage_results`) | DEFINER | Refuses a `related_ticket_ids` entry that names a ticket in another workspace. A ticket deleted while triage ran is let through. |
| `workspace_join_token()`, `rotate_workspace_join_token()` | DEFINER | Admins only (42501): read or replace their workspace's customer join token. Rotating is rate-limited (`workspace_join_rotate`). |
| `create_workspace_invite(text)`, `revoke_workspace_invite(uuid)` | DEFINER | Admins only. Create returns the invite token once and keeps its hash. It charges the `workspace_invite` limit before checking the email, so an admin can't probe for free whether an address has an account (that case returns `{"error": "already_has_account"}` rather than raising, which would roll the count back). |
| `consume_workspace_link_rate_limit(text)`             | DEFINER   | IP-keyed limiter for the signed-out `/join` and `/invite` token lookups (30 every 5 minutes), like the public status page's. `service_role` only. |
| `delete_empty_workspace()` (trigger, `after delete` on `workspace_members`) | DEFINER | Deletes a workspace with no members left, except the default one. |
| `can_view_ticket(uuid)`                               | **INVOKER** | "Can the caller see this ticket?" for child tables. INVOKER on purpose: it inherits the caller's own `tickets` RLS. Making it DEFINER would bypass ticket RLS for every child table. |
| `handle_new_user()` (trigger)                         | DEFINER   | On `auth.users` insert: creates the `profiles` row and the membership (SUP-82). The role is **never read from sign-up metadata**. The trigger reads at most one intent and works the role out from what it can check: a workspace name creates that workspace with the person as `admin`; a valid join token makes them a `customer` of its workspace; a valid, unexpired invite for this exact email makes them an `agent` and uses the invite up; no intent joins the default workspace as a `customer`. A bad token, or more than one intent, aborts the sign-up rather than placing anyone in the wrong workspace. The intent keys are then removed from the account's metadata. Skipped for a user with no email. |
| `ensure_profile()`                                    | DEFINER   | Get-or-create the caller's profile and membership (first needed when `auth.users` was shared with notes-collections; kept so code never assumes the row exists). Always creates a `customer` of the default workspace. Returns the profile with `role` and `workspace_id`. |
| `admin_set_role(uuid, app_role)`                      | DEFINER   | The only path to change a role, inside the caller's own workspace: a target in another workspace is "no such user". Re-checks `is_admin()`; takes a per-workspace advisory lock so two concurrent demotions can't both pass the last-admin check; refuses changing your own role and demoting the workspace's last admin; demoting staff to `customer` unassigns their tickets so they return to the shared queue. |
| `review_triage(uuid, uuid, ticket_priority, ticket_category, ticket_team)` | DEFINER | Staff confirm or correct a ticket's AI triage. Checks `is_staff()` and visibility itself (admins: any ticket; agents: unassigned or their own -- mirrors `tickets_select`, since `can_view_ticket()` would see everything inside a DEFINER function); refuses a `p_result_id` that is not the ticket's latest run (`stale_triage`); writes the fields plus `reviewed_*`, a `*_changed` event per changed field and a `triage_reviewed` event (`confirmed` / `corrected` / `manual`). Granted to `authenticated`. |
| `set_updated_at()` (trigger)                          | INVOKER   | Maintains `tickets.updated_at`.                                                                               |
| `guard_ticket_update()` (trigger, `before update` on `tickets`) | DEFINER | Immutable `customer_id`/`subject`/`body`; `assignee_id` must be an agent or admin; legal status transitions (agents only -- admins bypass); stamps `resolved_at`/`closed_at`; writes `ticket_events`. DEFINER so it can insert into `ticket_events`. |
| `stamp_first_response()` (trigger, `after insert` on `ticket_comments`) | DEFINER | Sets `tickets.first_response_at` on the first public staff comment.                                    |
| `guard_last_admin_delete()` (trigger, `before delete` on `profiles`) | DEFINER | Refuses to delete a workspace's only admin while it has other members, and the default workspace's only admin at any time. Because account deletion is a cascade from `auth.users`, the raise aborts the whole deletion. An admin alone in their own workspace can leave, and the workspace goes with them. |
| `export_own_data()`                                   | **INVOKER** | GDPR Art. 15/20 export: one `jsonb` with the caller's profile, own tickets (with comments and history), comments and actions on other tickets, assigned tickets, published share links, notes and assistant chats. INVOKER so RLS still applies (a customer gets no internal comments or triage output) and every branch is also pinned to `auth.uid()`. Granted to `authenticated`. |
| `consume_rate_limit(text)`                            | DEFINER   | Fixed-window counter. The caller names only the action (`create_ticket` / `add_comment` / `rerun_triage` / `assistant_message` / `save_note` and the others below); limit and window are hard-coded per action inside the function, and the key's identity half comes from `auth.uid()` -- so a client can neither loosen its own limit, target another user's bucket, nor mint rows with made-up windows. For the staff AI actions it then charges the workspace's budget too (SUP-83), only once the person's own limit has passed; when the workspace refuses, the person's count is given back. Returns `false` when over the limit; prunes windows older than a day on ~1% of calls. |
| `consume_triage_budget(uuid)`                         | DEFINER   | One unit of the ticket's workspace's triage budget (200 an hour), spent before any model call of a triage run. The workspace comes from the ticket, since the triage pipeline runs as the service role. `false` fails the run with reason `budget`; the ticket stays filed. `service_role` only. |
| `create_triage_state()` (trigger, `after insert` on `tickets`) | DEFINER | Creates the ticket's `ticket_triage_state` row so the triage pipeline always has a row to claim. |
| `rate_limit_ticket_insert()`, `rate_limit_comment_insert()` (triggers, `before insert`) | INVOKER | Call `consume_rate_limit()` for the inserting user and raise `rate_limited:<action>` when over -- so the limit applies to direct Data API calls too, not just the app. Skipped for `service_role` (`auth.uid()` is null). |
| `sync_profile_email()` (trigger, `after update of email` on `auth.users`) | DEFINER | Keeps `profiles.email` equal to the auth email. Users cannot update `profiles.email` themselves. |
| `match_tickets(vector(1536), int, uuid)`              | INVOKER   | Nearest tickets by cosine distance (`<=>`), returning subject + latest summary only, and only from the workspace of the ticket being triaged (the excluded id; an unknown id matches nothing). An iterative HNSW scan keeps going until enough rows pass the workspace filter. EXECUTE revoked from PUBLIC; granted to `service_role` only. `match_triage_corrections()` and `detect_incident()` are scoped the same way (`docs/learning.md`, `docs/incidents.md`). |
| `save_note(uuid, text, text, jsonb, text)`           | INVOKER   | Insert (`p_id` null) or update the caller's own note **and** replace its chunks in one transaction. INVOKER so the caller's RLS and column grants on `notes`/`documents` apply inside; owner is `auth.uid()`, never an argument. Returns null when an update matched nothing visible. Granted to `authenticated`. |
| `set_own_presence(text)`                              | DEFINER   | The write path for `profiles.presence` (with `sign_out_presence()` below), which also stamps `presence_set_at` (SUP-85): always the caller's own row (`auth.uid()`, no id parameter), staff only (42501), one of the three values (22023), rate-limited (`set_presence`). Signing out calls it with `offline`. Granted to `authenticated`. |
| `sign_out_presence()`, `resume_presence_after_sign_in()` | DEFINER | SUP-85. Sign-out sets the caller's own row Offline with `presence_set_at = 'infinity'`: staff only (42501), rate-limited as `set_presence`. Sign-in clears that hold (only the caller's own row, only when it holds), so working hours decide the status again. |
| `workday_start(uuid)`, `cases_assigned_today(uuid)`   | DEFINER   | Local midnight in the person's `timezone`, and the distinct tickets that became theirs since then (from `assignee_changed` events). `cases_assigned_today` is not `STABLE` on purpose: after the cap trigger's lock, it must see assignments committed while it waited. Not granted to clients. |
| `enforce_daily_case_cap()` (triggers `tickets_00_daily_case_cap`, `before update of assignee_id`, and `tickets_00_daily_case_cap_insert`, `before insert` with an assignee) | DEFINER | Refuses a new assignee who already has their cap of new cases today (`daily_case_cap_reached`). Uncapped people skip it, and a ticket given back the same day isn't a new case. A per-person advisory lock makes two claims at once queue up, and the cap is re-read after it. The `00` names make it fire before `tickets_guard_update`, which records the `assignee_changed` event the next claim counts. |
| `admin_workload()`, `admin_set_workload(uuid, int, text, smallint[], time, time)` | DEFINER | The Admin > Workload page: every agent and admin with their cap, timezone, working hours, last status pick and today's count; and the only write path for `daily_case_cap`/`timezone`/the working hours (invalid hours: 22023). Admins only (42501); an invalid cap or a timezone missing from `pg_timezone_names` raises 22023, and a target who isn't staff P0002. Granted to `authenticated`. |
| `match_documents(vector(1536), float, int)`          | INVOKER   | Nearest note chunks by cosine distance above a similarity threshold, **for the calling user only**: filters `user_id = auth.uid()` itself and, being INVOKER, also runs under the `documents` RLS policy. Deliberately takes **no user-id parameter** -- a parameter the client supplies is one it can lie about. Granted to `authenticated`. |

EXECUTE on every callable function above is revoked from `PUBLIC` and granted explicitly:
`authenticated` for the helpers, `ensure_profile`, `admin_set_role`, `consume_rate_limit`,
`save_note`, `match_documents`, `export_own_data`, `review_triage` (RLS policies, the rate-limit triggers and notes run as the caller
and need them), `service_role` where the triage code calls them, and `service_role` only for
`match_tickets`. `alter default privileges`
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

| Action          | Limit | Workspace cap | Window     | Where enforced                                                     |
|-----------------|-------|---------------|------------|--------------------------------------------------------------------|
| `create_ticket` | 10    | --            | 60 minutes | `BEFORE INSERT` trigger on `tickets` (database)                    |
| `add_comment`   | 30    | --            | 10 minutes | `BEFORE INSERT` trigger on `ticket_comments` (database)            |
| `rerun_triage`  | 5     | 50            | 10 minutes | `rerunTriageAction()` via `checkRateLimit()` (no row is inserted) |
| `assistant_message` | 20 | 200          | 10 minutes | `sendMessageAction()` via `checkRateLimit()` -- a paid completion (up to 3 with tool rounds) |
| `save_note`     | 30    | 200           | 10 minutes | `createNoteAction()` / `updateNoteAction()` via `checkRateLimit()` -- a paid embedding call, before any row is written (not consumed for a no-op edit or a missing note) |
| `staff_create_ticket` | 30 | --         | 60 minutes | Inside `staff_create_ticket()` (database), on every call |
| `rate_ticket`   | 10    | --            | 10 minutes | Inside `rate_ticket()` (database): rating a resolved ticket (CSAT) |
| `update_profile` | 20   | --            | 10 minutes | Inside `update_own_profile()` (database): account settings |
| `update_avatar` | 10    | --            | 10 minutes | Profile picture upload via `checkRateLimit()` |
| `access_token`  | 10    | --            | 60 minutes | `BEFORE INSERT` trigger on `access_tokens` (database): creating an MCP token |
| `mcp_request`   | 120   | --            | 10 minutes | Every `/api/mcp` request via `checkRateLimit()`, per token owner; the AI calls it makes count under their own actions |
| `set_presence`  | 60    | --            | 10 minutes | Inside `set_own_presence()` (database) |
| `workspace_invite` | 20 | --            | 60 minutes | Inside `create_workspace_invite()` (database), per admin           |
| `workspace_join_rotate` | 10 | --       | 60 minutes | Inside `rotate_workspace_join_token()` (database), per admin       |
| triage budget   | --    | 200           | 60 minutes | `consume_triage_budget()`, before each triage run's model calls    |

**Workspace caps (SUP-83).** Per-person limits alone would let a workspace spend as many model
calls as it has people. The staff-only AI actions above therefore also count against a
workspace-wide cap, and every triage run spends one unit of its workspace's triage budget.
Filing a ticket and MCP requests stay per person only, on purpose: customers sign themselves up,
so a workspace-wide cap on filing would let a few throwaway accounts stop every real customer in
a workspace from filing for an hour. Over the triage budget, the ticket is still filed; its
triage fails with reason `budget` and staff can re-run it later.

The insert limits are enforced in the database so that a user calling the Data API directly with
their session token is limited exactly like the app. The app maps the trigger's
`rate_limited:*` exception to a friendly form error (`RateLimitError`), never an unhandled
exception. Text lengths are also constrained in the database: `subject` 1-200, ticket `body`
1-20000, comment `body` 1-10000, note `title` 1-200, note `body` 1-20000, assistant message 1-8000,
`full_name` <= 120. Supabase Auth's own built-in sign-up/sign-in rate limits are configured in
the dashboard (Authentication -> Rate Limits) and are **not** captured by migrations.

### `ticketing.shared_ticket_summaries`

Backs the shareable public status page (`app/s/[token]/page.tsx`). One row per publish action;
unpublishing sets `revoked = true` rather than deleting, keeping an audit trail.

| Column         | Type                      | Notes                                                                |
|----------------|---------------------------|-----------------------------------------------------------------------|
| `id`           | `uuid`                    | Primary key.                                                          |
| `ticket_id`    | `uuid`                    | FK -> `tickets.id`, `on delete cascade`.                              |
| `token`        | `text`                    | Unique. `encode(gen_random_bytes(16), 'hex')` -- 128 bits of entropy. **This is the entire access control for the public read** -- the same trust model as a password-reset link. No `anon` grant exists on this table at all; the public page reads it with the service role by exact token match. |
| `published_by` | `uuid`                    | FK -> `auth.users.id`, `on delete cascade`.                           |
| `subject`, `status`, `summary` | various  | **Snapshot** at publish time, not a live join -- the public route never touches `tickets` or `triage_results`. |
| `revoked`      | `boolean`                 | Default `false`. One-directional: the update policy only allows flipping this to `true`, never back -- see below. |
| `expires_at`   | `timestamptz`             | Default `now() + 30 days`. Checked (`> now()`) by the public read alongside `revoked = false`. |
| `created_at`   | `timestamptz`             |                                                                        |

At most one active (`not revoked`) share per ticket, enforced by a partial unique index
(`shared_ticket_summaries_one_active_per_ticket`) -- `publishTicketSummary()` revokes any
existing active share for the ticket before inserting a new one, so there's never an orphaned
older token still resolving after a republish.

RLS (staff-side management only -- see the table below for the public-read story):

| Operation | Rule |
|---|---|
| select | `is_staff()` and `can_view_ticket(ticket_id)` |
| insert | `published_by = auth.uid()` and `is_staff()` and `can_view_ticket(ticket_id)` |
| update | `is_staff()` and `can_view_ticket(ticket_id)`; column-limited to `revoked`, and the `with check` only allows `revoked = true` -- a raw PATCH cannot un-revoke a link a colleague took down |
| delete | none |

`anon` has no grant on this table -- unlike every other table here, which grants to
`authenticated`, this one grants nothing to either `anon` or `authenticated` for the public read
path. `app/lib/db/shares.ts`'s `getPublicSharedSummary()` is the only code path that can read a
row by token; it validates the token shape, matches it exactly, checks `expires_at`, and selects
only the four public-safe columns -- never a broad `select *`, never a `like`, never a join.

Since this is the app's only unauthenticated route, it also needs its own rate limiter --
`consume_public_share_rate_limit(ip)` is a separate, IP-keyed sibling of `consume_rate_limit()`
(which requires `auth.uid()` and so can't apply here), executable by `service_role` only. It
bounds cost/availability abuse of the endpoint; the 128-bit token already makes guessing a
*valid* token practically infeasible, so this isn't a data-exposure control.

## Admin surface

`/admin` (overview analytics), `/admin/users` (role management), `/admin/workload` (daily
case caps, timezones and working hours, SUP-77/SUP-85) and `/admin/workspace` (the customer join
link and agent invites, SUP-82) are gated by `requireAdmin()`
in the route-segment layout and again in each page. Analytics are aggregated in app code over a
bounded select that runs as the signed-in admin -- RLS is what makes it "all tickets" of their
workspace. Role
changes call `admin_set_role()`; reassignment is a plain `tickets` update permitted for admins by
`tickets_update_staff` and validated by `guard_ticket_update()`.

## Notes

The `triaged` status
value exists in the enum and the transition map (`assigned -> triaged`) but nothing sets it
automatically -- AI triage is advisory and never changes `status`.
