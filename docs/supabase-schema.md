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
  `ticketing.profiles` row and never fires the on-signup trigger below. App code must
  get-or-create a profile on first touch (`ticketing.ensure_profile()`), not assume every
  signed-in user already has one.
- The `ticketing` schema must be added to **Data API -> Exposed schemas** in the Supabase
  dashboard (Settings -> API) before `supabase-js` can query it with `.schema('ticketing')` --
  only `public` is exposed by default.
- `public` and `ticketing` never reference each other. RLS policies, helper functions, and
  grants in this app are scoped entirely to `ticketing.*`.

## Tables

### `ticketing.profiles`

One row per `auth.users.id`. Created automatically on signup, or lazily via
`ticketing.ensure_profile()` for pre-existing users.

| Column       | Type                  | Notes                                                        |
|--------------|-----------------------|---------------------------------------------------------------|
| `id`         | `uuid`                | Primary key. FK -> `auth.users.id`, `on delete cascade`.     |
| `email`      | `text`                | Copied from `auth.users` at profile-creation time.            |
| `full_name`  | `text`                | Nullable, user-editable.                                       |
| `role`       | `ticketing.app_role`  | `customer` \| `agent` \| `admin`. Defaults to `customer`.      |
| `created_at` | `timestamptz`         | Default `now()`.                                                |
| `updated_at` | `timestamptz`         | Default `now()`.                                                |

`role` can **only** change via the `ticketing.admin_set_role()` RPC (`SECURITY DEFINER`, checks
`is_admin()` itself). Clients are granted `update` on `email`/`full_name`/`updated_at` only --
`role` is revoked at the column-privilege level, independent of RLS, so even an RLS policy bug
could not let a client overwrite their own role.

## Row Level Security

- `profiles_select_own` -- a user can always read their own row.
- `profiles_select_staff` -- `agent`/`admin` roles can read every profile (needed to show ticket
  ownership to staff).
- `profiles_update_own` -- a user can update their own row, restricted to the non-role columns
  by the column grant above.
- No policy grants `insert` to `authenticated` -- rows are only ever created by the
  `SECURITY DEFINER` trigger/RPC below, which bypass RLS and grants entirely.

## Signup / role assignment

- `ticketing.handle_new_user()` fires `after insert on auth.users` and inserts a `profiles` row
  with **`role` hard-coded to `'customer'`**, ignoring any `raw_user_meta_data` the client sent
  at signup. This is deliberate: if the trigger instead trusted client-supplied metadata (e.g.
  `supabase.auth.signUp({ options: { data: { role: 'admin' } } })`), any visitor could
  self-escalate to admin on signup.
- `ticketing.ensure_profile()` is the get-or-create path for users who signed up before this
  app existed for them (see "shared `auth.users`" above). Callable by any authenticated user;
  always creates with `role = 'customer'`.
- `ticketing.admin_set_role(target_user_id, new_role)` is the only way to promote a user to
  `agent` or `admin`. Re-checks `is_admin()` internally rather than trusting the caller.

## Helper functions

`ticketing.app_role()`, `ticketing.is_staff()`, `ticketing.is_admin()` -- all `stable security
definer set search_path = ''`, used inside RLS policies (wrapped as
`(select ticketing.is_admin())` so Postgres caches the result per statement). `SECURITY DEFINER`
is what lets a `profiles` policy check the caller's role without recursing into the
`profiles`-table policy it's part of.
